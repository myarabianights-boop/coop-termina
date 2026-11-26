ctx.fillStyle = '#fff'; ctx.font = '20px monospace'; ctx.fillText('Loading structures and atlas...', 20, 40);
loadStructures().then(() => { startWorld(); requestAnimationFrame(frame); }).catch(e => {
  console.error('[startup] the game could not start:', e);
  fatal = { title: 'The game could not start', lines: [
    ...String(e && e.message || e).split('\n').slice(0, 8),
    '', 'Open the browser console (F12) for details.',
    ...(location.protocol === 'file:' ? ['This page was opened as a file. Run a local server in the project folder', '(for example: python -m http.server) and open http://localhost:8000/ instead.'] : []),
  ] };
  drawFatal();
});
