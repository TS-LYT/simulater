export function connectSealinxLive(hooks) {
  const status = document.getElementById('live-status');
  const setStatus = (text) => {
    if (status) status.textContent = text;
  };
  const url = `${window.location.protocol}//${window.location.hostname}:8765/events`;
  const local = '/events';

  const attach = (source, label) => {
    source.onopen = () => setStatus(`仿真桥接已连接（${label}）`);
    source.onerror = () => {
      source.close();
      if (label === local) {
        setStatus('仿真桥接未连接，正在改连 8765…');
        attach(new EventSource(url), url);
      } else {
        setStatus('仿真桥接未连接');
      }
    };
    source.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'packet' && hooks.onPacket) {
          hooks.onPacket(msg);
          setStatus(`仿真包 N${msg.src} → N${msg.dst}  ${msg.payload || ''}`.trim());
        } else if (msg.type === 'join') {
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
