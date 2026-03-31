/**
 * POST /api/demo-token
 * Signs a real JWT for demo/mock users (no SharePoint lookup).
 * Only for demo branch — remove in production.
 */
import { signToken } from './jwt.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, name, role, sede, email } = req.body ?? {};
  if (!id || !name || !role) {
    return res.status(400).json({ error: 'id, name, and role are required' });
  }

  try {
    const token = await signToken({ id, name, role, sede: sede || 'HPR', email: email || '' });
    return res.status(200).json({ token });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
