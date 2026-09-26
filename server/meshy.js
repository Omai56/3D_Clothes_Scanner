const BASE = 'https://api.meshy.ai/openapi/v2';

function headers() {
  return {
    Authorization: `Bearer ${process.env.MESHY_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function startImageTo3D(imageUrl) {
  const r = await fetch(`${BASE}/image-to-3d`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ image_url: imageUrl, enable_pbr: true, should_remesh: true }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Meshy ${r.status}: ${body.slice(0, 200)}`);
  }
  const { result } = await r.json();
  return result; // task ID string
}

export async function getTask(taskId) {
  const r = await fetch(`${BASE}/image-to-3d/${taskId}`, {
    headers: headers(),
  });
  if (!r.ok) throw new Error(`Meshy ${r.status}`);
  return r.json(); // { status, progress, model_urls, task_error }
}
