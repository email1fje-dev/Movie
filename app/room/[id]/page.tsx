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

        <div className="player-shell">
          <video
            ref={video}
            controls={isHost}
            src={movie.video_url}
            onLoadedMetadata={loaded}
            onPlay={play}
            onPause={pause}
            onSeeked={seek}
          />

          {!isHost && (
            <div className="viewer-lock">
              <span>🔒</span>
              <b>Host controls playback</b>
              <small>
                You can watch and chat — playback controls are locked.
              </small>
              <button className="sync-btn" onClick={resync}>
                ↻ Sync now
              </button>
            </div>
          )}
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
