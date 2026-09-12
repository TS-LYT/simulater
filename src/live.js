let generation = 0;
let current = null;

function statusEl() {
  return document.getElementById('live-status');
}

function setStatus(text) {
  const el = statusEl();
  if (el) el.textContent = text;
}

export function disconnectSealinxLive() {
  generation += 1;
  if (current) {
    current.close();
    current = null;
  }
}

export function connectSealinxLive(hooks = {}) {
  disconnectSealinxLive();
  const myGen = generation;
  const url = `${window.location.protocol}//${window.location.hostname}:8765/events`;
  const local = '/events';

  const attach = (source, label) => {
    if (myGen !== generation) {
      source.close();
      return source;
    }
    current = source;
    source.onopen = () => {
      if (myGen !== generation) return;
      setStatus(`仿真桥接已连接（${label}）`);
    };
    source.onerror = () => {
      source.close();
      if (myGen !== generation) return;
      if (current === source) current = null;
      if (label === local) {
        setStatus('仿真桥接未连接，正在改连 8765…');
        attach(new EventSource(url), url);
      } else {
        setStatus('仿真桥接未连接');
      }
    };
    source.onmessage = (event) => {
      if (myGen !== generation) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'packet' && hooks.onPacket) {
          hooks.onPacket(msg);
          setStatus(`仿真包 N${msg.src} → N${msg.dst}  ${msg.payload || ''}`.trim());
        } else if (msg.type === 'join') {
          if (hooks.onJoin) hooks.onJoin(msg);
          setStatus(`节点 N${msg.node} 接入仿真平台`);
        }
      } catch (err) {
        console.warn('live event', err);
      }
    };
    return source;
  };

  try {
    return attach(new EventSource(local), local);
  } catch (err) {
    setStatus('无法连接仿真桥接');
    return null;
  }
}
