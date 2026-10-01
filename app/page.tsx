"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [movies, setMovies] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadMovies = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, error } = await supabase
      .from("movies")
      .select("*")
      .eq("is_public", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Movie list error:", error);
      setMovies([]);
      setError("Could not load movies. Please try again.");
    } else {
      setMovies(data ?? []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadMovies();
  }, [loadMovies]);

  const search = q.trim().toLowerCase();
  const filtered = movies.filter((m) =>
    String(m.title ?? "").toLowerCase().includes(search) ||
    String(m.genre ?? "").toLowerCase().includes(search)
  );

  return (
    <section>
      <div className="hero">
        <div>
          <p className="eyebrow">WATCH TOGETHER</p>
          <h1>Movie night, but <span>everyone is synced.</span></h1>
          <p className="sub">
            Pick a movie, create a room, invite your friends, and watch it
            together with synced playback and live chat.
          </p>
        </div>
        <div className="hero-card">
          🎬
          <b>SYNCED PLAYBACK</b>
          <small>Play • Pause • Seek • Resync</small>
        </div>
      </div>

      <div className="toolbar">
        <h2>Movies</h2>
        <input
          placeholder="Search movies..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="empty">Loading movies...</div>
      ) : error ? (
        <div className="empty">
          <p>{error}</p>
          <button className="button" onClick={loadMovies}>Retry</button>
        </div>
      ) : (
        <>
          <div className="grid">
            {filtered.map((m) => (
              <article className="movie" key={m.id}>
                {m.poster_url ? (
                  <img src={m.poster_url} alt={m.title || ""} />
                ) : (
                  <div className="poster">🎞️</div>
                )}
                <div className="movie-body">
                  <h3>{m.title}</h3>
                  <p>
                    {m.year || "—"} · {m.genre || "Movie"}
                    {m.duration ? " · " + m.duration + " min" : ""}
                  </p>
                  <Link className="button" href={"/movie/" + m.id}>Open movie</Link>
                </div>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <div className="empty">
              No public movies yet. An admin can add one from the Admin panel.
            </div>
          )}
        </>
      )}
    </section>
  );
}