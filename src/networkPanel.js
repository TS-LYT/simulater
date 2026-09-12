import { escapeHtml as esc } from './uiBind.js';

export function createNetworkPanel(engine, actions) {
  const panel = document.createElement('section'); panel.className = 'network-panel';
  panel.innerHTML = `<details><summary>自动组网 · 路由 / 链状 / 簇状</summary>
    <fieldset id="network-settings">
    <label>组网 <select id="network-topology"><option value="auto">自动路由</option><option value="chain">链状</option><option value="cluster">簇状</option></select></label>
    <label>调度 <select id="network-schedule"><option value="fixed">全网 TDMA</option><option value="route">路由顺序 TDMA</option><option value="cluster">分簇两阶段 TDMA</option></select></label>
    <label>汇聚 <select id="network-sink"></select></label>
    <label>产生周期 <select id="network-generation"><option value="4">每 4 帧（默认）</option><option value="1">每帧（压力测试）</option></select></label>
    <label>总包长 <input id="network-bytes" type="number" value="32" min="1" max="4096">字节</label>
    <label>有效速率 <input id="network-rate" type="number" value="2400" min="1">bit/s</label>
    <label>时隙 <select id="network-slot-mode"><option value="auto">自动计算</option><option value="manual">手动指定</option></select><input id="network-slot" type="number" value="5.67" min="0.01" step="0.01">秒</label>
    <div id="network-chain"></div><div id="network-clusters"></div>
    </fieldset>
    <div class="network-actions"><button id="network-start">启动</button><button id="network-pause">暂停</button><button id="network-stop">停止</button><button id="network-reset">重置统计</button></div>
    <p id="network-status" aria-live="polite"></p><div id="network-nodes"></div><div id="network-packets"></div></details>`;
  document.getElementById('console-sim').prepend(panel);
  const $ = id => panel.querySelector(`#network-${id}`);
  const sync = () => {
    const c = engine.config;
    c.topology = $('topology').value; c.schedule = $('schedule').value; c.sink = Number($('sink').value);
    c.bytes = Number($('bytes').value); c.bitrate = Number($('rate').value);
    c.generationFrames = Number($('generation').value);
    c.manualSlot = $('slot-mode').value === 'auto' ? 0 : Number($('slot').value);
    if ($('slot-mode').value === 'manual' && !(c.manualSlot > 0)) throw Error('手动时隙必须大于零');
  };
  $('topology').onchange = () => {
    engine.config.topology = $('topology').value;
    $('schedule').value = { auto: 'fixed', chain: 'route', cluster: 'cluster' }[$('topology').value];
    sync(); renderConfig();
  };
  $('sink').onchange = () => {
    sync(); const c = engine.config;
    c.chain = [...c.chain.filter(id => id !== c.sink), c.sink];
    c.clusters = c.clusters.filter(v => v.head !== c.sink).map(v => ({ ...v, members: v.members.filter(id => id !== c.sink) }));
    renderConfig();
  };
  function renderConfig() {
    const c = engine.config;
    $('schedule').querySelector('[value="cluster"]').disabled = c.topology !== 'cluster';
    $('chain').hidden = c.topology !== 'chain'; $('clusters').hidden = c.topology !== 'cluster';
    $('chain').innerHTML = `链顺序：${c.chain.map((id, i) => `<span>N${id} ${id !== c.sink ? `<button type="button" data-index="${i}" data-step="-1">↑</button><button type="button" data-index="${i}" data-step="1">↓</button>` : ''}</span>`).join(' → ')}<button type="button" id="network-chain-add">加入未配置节点</button>`;
    $('chain').querySelectorAll('[data-index]').forEach(button => { button.onclick = () => {
      const i = Number(button.dataset.index), j = i + Number(button.dataset.step);
      if (j >= 0 && j < c.chain.length - 1) [c.chain[i], c.chain[j]] = [c.chain[j], c.chain[i]];
      renderConfig();
    }; });
    $('chain-add').onclick = () => { c.chain = [...c.chain.filter(id => id !== c.sink), ...engine.nodes().map(n => n.id).filter(id => id !== c.sink && !c.chain.includes(id)), c.sink]; renderConfig(); };
    $('clusters').innerHTML = engine.nodes().filter(n => n.id !== c.sink).map(n => {
      const cluster = c.clusters.find(v => v.head === n.id || v.members.includes(n.id));
      const value = cluster ? cluster.head === n.id ? 'head' : String(cluster.head) : '';
      return `<label>N${n.id}<select data-node="${n.id}"><option value="">未配置</option><option value="head" ${value === 'head' ? 'selected' : ''}>作为簇头</option>${c.clusters.filter(v => v.head !== n.id).map(v => `<option value="${v.head}" ${value === String(v.head) ? 'selected' : ''}>加入 N${v.head} 簇</option>`).join('')}</select></label>`;
    }).join('');
    $('clusters').querySelectorAll('[data-node]').forEach(select => { select.onchange = () => {
      const id = Number(select.dataset.node);
      c.clusters = c.clusters.filter(v => v.head !== id).map(v => ({ ...v, members: v.members.filter(member => member !== id) }));
      if (select.value === 'head') c.clusters.push({ head: id, members: [] });
      else if (select.value) c.clusters.find(v => v.head === Number(select.value))?.members.push(id);
      renderConfig();
    }; });
  }
  $('start').onclick = () => { try { sync(); engine.validate(); actions.start(); } catch (error) { engine.error = error.message; render(); } };
  $('pause').onclick = () => { try { actions.pause(); } catch (error) { engine.error = error.message; render(); } };
  $('stop').onclick = actions.stop; $('reset').onclick = actions.reset;
  let nodeKey = '';
  function render() {
    const key = engine.nodes().map(n => n.id).join(',');
    if (key !== nodeKey) {
      nodeKey = key; $('sink').innerHTML = engine.nodes().map(n => `<option value="${n.id}" ${n.id === engine.config.sink ? 'selected' : ''}>N${n.id}</option>`).join(''); renderConfig();
    }
    const active = engine.status !== 'stopped';
    $('settings').disabled = active; $('start').disabled = active; $('pause').disabled = !active;
    $('pause').textContent = engine.status === 'paused' ? '继续' : '暂停';
    const s = engine.stats;
    $('status').textContent = `${engine.error || ''} ${ { stopped: '已停止', running: '运行中', paused: '已暂停' }[engine.status]} · 帧 ${engine.frame} · 当前 N${engine.currentSender || '—'} · ${engine.config.schedule === 'cluster' ? engine.config.clusters.some(v => v.head === engine.currentSender) ? '簇间阶段' : '成员阶段' : 'TDMA'} · 时隙 ${(engine.slotLength || engine.minimumSlot()).toFixed(2)}s · 生成 ${s.generated} / 送达 ${s.delivered} / 丢弃 ${s.dropped} · 平均时延 ${s.delivered ? (s.latency / s.delivered).toFixed(2) : '—'}s`;
    $('nodes').textContent = engine.nodes().map(n => {
      const cluster = engine.config.clusters.find(c => c.head === n.id || c.members.includes(n.id));
      const role = engine.config.topology === 'cluster' && cluster ? ` · N${cluster.head}簇${cluster.head === n.id ? '簇头' : '成员'}` : '';
      return `N${n.id}${role}: 时隙 ${engine.slots.indexOf(n.id) + 1 || '—'} / 队列 ${(engine.queues.get(n.id) || []).filter(p => !p.done).length} · ${engine.routes.get(n.id)?.join('→') || '无路由/未配置'}`;
    }).join(' ｜ ');
    const opened = new Set([...$('packets').querySelectorAll('details[open]')].map(d => d.dataset.id));
    $('packets').innerHTML = engine.records.slice(-30).reverse().map(p => `<details data-id="${p.id}" ${opened.has(String(p.id)) ? 'open' : ''}><summary>#${p.id} N${p.source}→N${p.destination} ${esc(p.status)} · ${p.visited.join('→')}</summary>${p.hops.map(h => `<div>N${h.from}→N${h.to}：发送 ${h.sent.toFixed(3)}s / 前沿 ${h.arrived?.toFixed(3) ?? '—'}s / 完整 ${h.completed?.toFixed(3) ?? '—'}s</div>`).join('')}</details>`).join('');
  }
  render(); renderConfig(); return { render, panel };
}
