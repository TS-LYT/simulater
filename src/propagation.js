// Recipient IDs are fixed at emission. All distances use physical coordinates.
export function configureRecipients(pulse, nodes, mode, targetId, live = false) {
  pulse.sendMode = mode;
  pulse.targetId = mode === 'broadcast' ? null : targetId;
  pulse.recipientIds = new Set(nodes.filter(node => node.online !== false && node.id !== pulse.sourceId
    && (live ? node.id === targetId : pulse.evaluateNode(node).inRange || node.id === pulse.targetId))
    .map(node => node.id));
}

export function advanceRecipient(pulse, node, simTime) {
  if (!pulse.recipientIds.has(node.id) || pulse.hits.has(node.id)) return null;
  const hit = pulse.evaluateNode(node);
  const arrived = hit.inRange ? pulse.travelTime(simTime) + 1e-4 >= hit.tof
    : pulse.radius(simTime) >= pulse.maxRange - 1e-3;
  if (!arrived) return null;
  Object.assign(hit, { arrivedAt: simTime, position: { x: node.x, y: node.y, z: node.z },
    overheard: pulse.sendMode === 'target' && node.id !== pulse.targetId });
  pulse.hits.set(node.id, hit);
  return hit;
}
