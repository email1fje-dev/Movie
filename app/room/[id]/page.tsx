"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { getSessionId } from "../../../lib/session";

export default function Room() {
  const { id } = useParams<{ id: string }>();
  const video = useRef<HTMLVideoElement>(null);
  const channelRef = useRef<any>(null);
  const roomRef = useRef<any>(null);
  const uidRef = useRef("");
  const applying = useRef(false);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const [room, setRoom] = useState<any>();
  const [movie, setMovie] = useState<any>();
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [uid, setUid] = useState("");
  const [viewers, setViewers] = useState(1);
  const [connected, setConnected] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isHost = !!room && room.owner_id === uid;

  function updateViewers(channel: any) {
    const state = channel.presenceState();
    setViewers(Math.max(1, Object.keys(state).length));
  }

  async function saveState(time: number, playing: boolean) {
    await supabase
      .from("rooms")
      .update({
        playback_time: time,
        is_playing: playing,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }

  async function broadcastState(action: string) {
    const v = video.current;
    if (!v || !isHost || !channelRef.current) return;

    const playing = !v.paused;
    const time = v.currentTime;

    await channelRef.current.send({
      type: "broadcast",
      event: "playback",
      payload: {
        action,
        time,
        playing,
        sentAt: Date.now(),
      },
    });

    await saveState(time, playing);
  }

  function applyState(state: any) {
    const v = video.current;
    if (!v || !state) return;

    const target = state.playing
      ? state.time + (Date.now() - state.sentAt) / 1000
      : state.time;

    applying.current = true;

    if (Math.abs(v.currentTime - target) > 0.25) {
      v.currentTime = Math.max(0, target);
    }

    if (state.playing) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }

    setTimeout(() => {
      applying.current = false;
    }, 180);
  }

  useEffect(() => {
    let channel: any;
    let cancelled = false;

    async function init() {
      const sid = getSessionId();
      uidRef.current = sid;
      setUid(sid);

      const { data: r } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", id)
        .single();

      if (cancelled || !r) return;

      setRoom(r);
      roomRef.current = r;

      if (r.movie_id) {
        const { data: m } = await supabase
          .from("movies")
          .select("*")
          .eq("id", r.movie_id)
          .single();

        if (!cancelled) setMovie(m);
      }

      await supabase
        .from("room_members")
        .upsert({ room_id: id, user_id: sid });

      const { data: ms } = await supabase
        .from("room_messages")
        .select("*")
        .eq("room_id", id)
        .order("created_at");

      if (!cancelled) setMessages(ms || []);

      channel = supabase.channel("room:" + id, {
        config: {
          broadcast: { ack: false },
          presence: { key: sid },
        },
      });

      channel
        .on("broadcast", { event: "playback" }, ({ payload }: any) => {
          if (uidRef.current !== roomRef.current?.owner_id) {
            applyState(payload);
          }
        })
        .on("presence", { event: "sync" }, () => updateViewers(channel))
        .on("presence", { event: "join" }, () => updateViewers(channel))
        .on("presence", { event: "leave" }, () => updateViewers(channel))
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "room_messages",
            filter: "room_id=eq." + id,
          },
          (payload: any) => {
            setMessages((x) =>
              x.some((m) => m.id === payload.new.id)
                ? x
                : [...x, payload.new]
            );
          }
        )
        .subscribe(async (status: string) => {
          if (status !== "SUBSCRIBED") return;

          setConnected(true);
          await channel.track({
            userId: sid,
            online_at: new Date().toISOString(),
          });
          updateViewers(channel);

          if (r.owner_id === sid) {
            await channel.send({
              type: "broadcast",
              event: "playback",
              payload: {
                action: "state",
                time: r.playback_time || 0,
                playing: !!r.is_playing,
                sentAt: Date.now(),
              },
            });

            heartbeat.current = setInterval(() => {
              const v = video.current;
              if (v && !v.paused) broadcastState("heartbeat");
            }, 2000);
          }
        });

      channelRef.current = channel;
    }

    init();

    return () => {
      cancelled = true;

      if (heartbeat.current) {
        clearInterval(heartbeat.current);
        heartbeat.current = null;
      }

      if (channel) {
        channel.untrack().catch(() => {});
        supabase.removeChannel(channel);
      }
    };
  }, [id]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  function formatTime(value: number) {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const total = Math.floor(value);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function togglePlay() {
    const v = video.current;
    if (!v || !isHost) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function toggleMute() {
    const v = video.current;
    if (v) v.muted = !v.muted;
  }

  function showControls(autoHide = true) {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (autoHide) {
      controlsTimer.current = setTimeout(() => setControlsVisible(false), 2200);
    }
  }

  function fullscreen() {
    const el = video.current?.closest(".player-shell") as HTMLElement | null;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
    showControls(true);
  }
  }

  function loaded() {
    const current = roomRef.current;

    if (current && current.owner_id !== uidRef.current) {
      applyState({
        action: "initial",
        time: current.playback_time || 0,
        playing: !!current.is_playing,
        sentAt: Date.now(),
      });
    }
  }

  async function play() {
    if (isHost && !applying.current) await broadcastState("play");
  }

  async function pause() {
    if (isHost && !applying.current) await broadcastState("pause");
  }

  async function seek() {
    if (isHost && !applying.current) await broadcastState("seek");
  }

  async function resync() {
    const current = roomRef.current;

    if (current) {
      applyState({
        action: "resync",
        time: current.playback_time || 0,
        playing: !!current.is_playing,
        sentAt: Date.now(),
      });
    }
  }

  async function send() {
    if (!text.trim() || !uid) return;

    await supabase.from("room_messages").insert({
      room_id: id,
      user_id: uid,
      message: text.trim(),
    });

    setText("");
  }

  if (!room || !movie) {
    return <div className="empty">Loading room...</div>;
  }

  return (
    <div className="watch-page">
      <div className="watch-main">
        <div className="watch-head">
          <div>
            <div className="room-kicker">
              <span className="live-dot" /> LIVE WATCH PARTY
            </div>

            <h1>{room.name}</h1>

            <div className="room-meta">
              <span>🎬 {movie.title}</span>
              <span>
                👥 {viewers} {viewers === 1 ? "person" : "people"} in room
              </span>
              <span className={connected ? "online" : "offline"}>
                {connected ? "● Synced" : "● Connecting"}
              </span>
            </div>
          </div>

          <span className={"pill " + (isHost ? "host" : "")}>
            {isHost ? "HOST · CONTROLS" : "VIEWER · LOCKED"}
          </span>
        </div>

        <div\n          className={`player-shell ${isHost ? "is-host" : "is-viewer"} ${controlsVisible ? "controls-visible" : "controls-hidden"}`}\n          onMouseMove={() => showControls(true)}\n          onTouchStart={() => showControls(true)}\n        >
          <div className="player-topbar">
            <span className="player-status"><i /> LIVE SYNC</span>
            <span className="player-movie">{movie.title}</span>
          </div>

          <video
            ref={video}
            controls={false}
            src={movie.video_url}
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration || 0);
              setCurrentTime(e.currentTarget.currentTime || 0);
              loaded();
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onPlay={() => { setIsPlaying(true); play(); }}
            onPause={() => { setIsPlaying(false); pause(); }}
            onSeeked={seek}
          />

          <div className="player-gradient" />



          <div className="custom-controls">
            <div className="progress-row">
              <span>{formatTime(currentTime)}</span>
              <input
                className="progress"
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={Math.min(currentTime, duration || 0)}
                disabled={!isHost}
                onChange={(e) => {
                  if (!isHost || !video.current) return;
                  video.current.currentTime = Number(e.target.value);
                  setCurrentTime(Number(e.target.value));
                }}
              />
              <span>{formatTime(duration)}</span>
            </div>

            <div className="controls-row">
              <div className="controls-left">
                <button className="control-btn play-btn" onClick={togglePlay} disabled={!isHost} aria-label={isPlaying ? "Pause" : "Play"}>
                  {isPlaying ? "❚❚" : "▶"}
                </button>
                <button className="control-btn" onClick={toggleMute} aria-label="Mute or unmute">
                  🔊
                </button>
                <span className="control-label">{isHost ? "HOST CONTROLS" : "VIEWER MODE"}</span>
                {!isHost && <button className="control-btn sync-mini" onClick={resync} aria-label="Sync now">↻</button>}
              </div>
              <button className="control-btn" onClick={fullscreen} aria-label="Fullscreen">⛶</button>
            </div>
          </div>
        </div>

        <div className="player-info">
          <div>
            <b>{isHost ? "You are the host" : "You're watching with the room"}</b>
            <p>
              {isHost
                ? "Play, pause, and seek here — everyone follows you in real time."
                : "The host controls play, pause, and seeking for everyone."}
            </p>
          </div>

          <div className="sync-badge">⚡ LOW-LATENCY SYNC</div>
        </div>
      </div>

      <aside className="chat">
        <div className="chat-title">
          <div>
            <span className="eyebrow">ROOM CHAT</span>
            <h2>Talk while watching</h2>
          </div>

          <span className="viewer-count">👥 {viewers}</span>
        </div>

        <div className="messages">
          {messages.map((m) => (
            <div
              className={"message " + (m.user_id === uid ? "mine" : "")}
              key={m.id}
            >
              <small>
                {m.user_id === uid
                  ? "You"
                  : m.user_id === room.owner_id
                    ? "Host"
                    : "Viewer"}
              </small>
              <p>{m.message}</p>
            </div>
          ))}
        </div>

        <div className="chatbox">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message the room..."
          />
          <button onClick={send}>➤</button>
        </div>
      </aside>
    </div>
  );
}
