(function () {
  const sid = new URL(location.href).searchParams.get("session_id");
  const el = document.getElementById("session-meta");
  if (sid && el) el.textContent = "セッション ID: " + sid.slice(0, 20) + "…";
})();
