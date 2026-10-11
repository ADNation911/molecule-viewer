const configuredEndpoint = import.meta.env.VITE_RAG_API_URL?.trim();
const browserHost = typeof window === 'undefined' ? '' : window.location.hostname;
const browserOrigin = typeof window === 'undefined' ? '' : window.location.origin;
const isLocalBrowser = browserHost === '127.0.0.1' || browserHost === 'localhost';
const isViteDevelopment = isLocalBrowser && window.location.port === '5173';
const DEFAULT_ENDPOINT = configuredEndpoint || (isViteDevelopment ? 'http://127.0.0.1:8000' : browserOrigin || 'http://127.0.0.1:8000');

function endpointValue() {
  if (configuredEndpoint) return DEFAULT_ENDPOINT;
  try { return localStorage.getItem('molecule3d-assistant-endpoint') || DEFAULT_ENDPOINT; } catch { return DEFAULT_ENDPOINT; }
}

function normalizedEndpoint(value) {
  return value.trim().replace(/\/+$/, '');
}

function createMessage(role, text, disposition = '') {
  const article = document.createElement('article');
  article.className = `assistant-message is-${role}`;
  if (disposition) article.dataset.disposition = disposition;
  const label = document.createElement('span');
  label.className = 'assistant-message-label';
  label.textContent = role === 'user' ? 'You' : 'Molecule3D';
  const body = document.createElement('p');
  body.textContent = text;
  article.append(label, body);
  return article;
}

function createSources(sources) {
  const section = document.createElement('section');
  section.className = 'assistant-sources';
  const heading = document.createElement('h3');
  heading.textContent = `Sources · ${sources.length}`;
  section.append(heading);
  sources.forEach(source => {
    const link = document.createElement('a');
    link.className = 'assistant-source-card';
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    const badge = document.createElement('span');
    badge.className = 'source-number';
    badge.textContent = source.label;
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = source.title;
    const meta = document.createElement('small');
    meta.textContent = [source.publication, source.year].filter(Boolean).join(' · ') || 'Europe PMC';
    const excerpt = document.createElement('span');
    excerpt.className = 'source-excerpt';
    excerpt.textContent = source.excerpt;
    copy.append(title, meta, excerpt);
    link.append(badge, copy);
    section.append(link);
  });
  return section;
}

export function setupAssistant({ onRecord = () => {} } = {}) {
  const dialog = document.getElementById('assistant-dialog');
  const form = document.getElementById('assistant-form');
  const input = document.getElementById('assistant-question');
  const messages = document.getElementById('assistant-messages');
  const endpointInput = document.getElementById('assistant-endpoint');
  const status = document.getElementById('assistant-status');
  const submit = document.getElementById('assistant-submit');
  const headerDot = document.getElementById('assistant-status-dot');
  let conversationId = null;
  let working = false;

  endpointInput.value = endpointValue();

  function setStatus(kind, text) {
    status.dataset.status = kind;
    status.textContent = text;
    headerDot.dataset.status = kind;
  }

  async function checkHealth() {
    setStatus('checking', 'Checking assistant…');
    try {
      const response = await fetch(`${normalizedEndpoint(endpointInput.value)}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Health check failed');
      const health = await response.json();
      if (health.status === 'ready') {
        setStatus('ready', `${health.chat_model} · ${health.provider || 'ready'}`);
        submit.disabled = false;
      } else if (health.status === 'setup_required') {
        const missing = health.missing_models || health.missing_configuration || [];
        setStatus('setup', `Setup required: ${missing.join(', ')}`);
        submit.disabled = true;
      } else {
        setStatus('offline', 'Assistant is unavailable');
        submit.disabled = true;
      }
    } catch {
      setStatus('offline', 'The assistant server is offline');
      submit.disabled = true;
    }
  }

  function saveEndpoint() {
    endpointInput.value = normalizedEndpoint(endpointInput.value) || DEFAULT_ENDPOINT;
    try { localStorage.setItem('molecule3d-assistant-endpoint', endpointInput.value); } catch { /* Optional local preference. */ }
    conversationId = null;
    checkHealth();
  }

  document.querySelectorAll('[data-action="assistant"]').forEach(button => button.addEventListener('click', () => {
    checkHealth();
    queueMicrotask(() => input.focus());
  }));
  endpointInput.addEventListener('change', saveEndpoint);
  document.getElementById('assistant-retry').addEventListener('click', checkHealth);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || working) return;
    messages.append(createMessage('user', question));
    input.value = '';
    working = true;
    submit.disabled = true;
    setStatus('checking', 'Searching biomedical literature…');
    const pending = createMessage('assistant', 'Retrieving and checking evidence…');
    pending.classList.add('is-pending');
    messages.append(pending);
    messages.scrollTop = messages.scrollHeight;
    try {
      const response = await fetch(`${normalizedEndpoint(endpointInput.value)}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, conversation_id: conversationId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Assistant request failed (${response.status})`);
      conversationId = payload.conversation_id;
      pending.replaceWith(createMessage('assistant', payload.answer, payload.disposition));
      if (payload.sources?.length) messages.append(createSources(payload.sources));
      setStatus('ready', payload.disposition === 'answered' ? `${payload.sources.length} cited source${payload.sources.length === 1 ? '' : 's'}` : 'Ready for a molecule question');
      onRecord(payload.disposition === 'answered' ? `Assistant answered with ${payload.sources.length} cited sources` : 'Assistant declined or lacked evidence');
    } catch (error) {
      pending.replaceWith(createMessage('assistant', error.message || 'The assistant could not answer.', 'error'));
      setStatus('offline', 'Assistant request failed · check the server');
    } finally {
      working = false;
      submit.disabled = status.dataset.status !== 'ready';
      messages.scrollTop = messages.scrollHeight;
      input.focus();
    }
  });

  checkHealth();
}
