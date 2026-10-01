export function getSessionId(){if(typeof window==="undefined")return "";let id=localStorage.getItem("movie_night_session");if(!id){id=crypto.randomUUID();localStorage.setItem("movie_night_session",id)}return id}
export function getDisplayName(){if(typeof window==="undefined")return "Guest";return localStorage.getItem("movie_night_name")||"Guest"}
