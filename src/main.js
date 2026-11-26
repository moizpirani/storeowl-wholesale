import './styles.css';
import { createClient } from '@supabase/supabase-js';
import { makeDb, makeFake } from './db.js';
import { startApp } from './app.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// VITE_FAKE=1 (pictures on this computer only) runs on a pretend database. Never set it in Vercel.
const fake = import.meta.env.VITE_FAKE === '1';
if (!fake && (!url || !key)) {
  document.getElementById('app').innerHTML = '<main class="auth"><div class="card authcard"><h1>Setup missing</h1><p>This copy has no database address yet.</p></div></main>';
} else {
  const db = fake
    ? makeFake({ signedIn: import.meta.env.VITE_FAKE_USER || null })
    : makeDb(createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }));
  const go = () => { const A = startApp(document.getElementById('app'), db); if (fake) window.__sow = { A, db }; };
  if (fake && import.meta.env.VITE_FAKE_DEMO === '1') import('./demo.js').then((m) => m.seedDemo(db)).then(go); else go();
}
