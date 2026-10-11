import { createCitedReport, reportFilename } from './assistant-context.js';
import { downloadBlob } from './workspace-utils.js';

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

function createMessage(role, text, disposition = '', contextLabel = '') {
  const article = document.createElement('article');
  article.className = `assistant-message is-${role}`;
  if (disposition) article.dataset.disposition = disposition;
  const label = document.createElement('span');
  label.className = 'assistant-message-label';
  label.textContent = role === 'user' ? 'You' : 'Molecule3D';
  const body = document.createElement('p');
  body.textContent = text;
  article.append(label, body);
  if (contextLabel) {
    const context = document.createElement('span');
    context.className = 'assistant-message-context';
    context.textContent = `Context · ${contextLabel}`;
    article.append(context);
  }
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

function downloadReport(question, payload, context) {
  const content = createCitedReport({ question, answer: payload.answer, sources: payload.sources, context });
  downloadBlob(content, reportFilename(context), 'text/markdown;charset=utf-8');
}

function createResponse(question, payload, context, onViewerAction, onRecord) {
  const section = document.createElement('section');
  section.className = 'assistant-response';
  section.append(createMessage('assistant', payload.answer, payload.disposition));
  if (payload.sources?.length) section.append(createSources(payload.sources));
  if (payload.actions?.length || payload.sources?.length) {
    const tools = document.createElement('div');
    tools.className = 'assistant-response-tools';
    for (const action of payload.actions || []) {
      const button = document.createElement('button');
      button.className = 'button assistant-action';
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await onViewerAction(action);
          button.textContent = 'Applied';
        } catch (error) {
          button.textContent = 'Unavailable';
          button.title = error.message || 'The viewer action is no longer available.';
        }
      });
      tools.append(button);
    }
    if (payload.sources?.length) {
      const report = document.createElement('button');
      report.className = 'text-button assistant-report';
      report.type = 'button';
      report.textContent = 'Download cited report';
      report.addEventListener('click', () => {
        downloadReport(question, payload, context);
        onRecord('Downloaded cited literature report');
      });
      tools.append(report);
    }
    section.append(tools);
  }
  return section;
}

export function setupAssistant({ onRecord = () => {}, getStructureContext = () => null, onViewerAction = () => {} } = {}) {
  const dialog = document.getElementById('assistant-dialog');
  const form = document.getElementById('assistant-form');
  const input = document.getElementById('assistant-question');
  const messages = document.getElementById('assistant-messages');
  const endpointInput = document.getElementById('assistant-endpoint');
  const status = document.getElementById('assistant-status');
  const submit = document.getElementById('assistant-submit');
  const headerDot = document.getElementById('assistant-status-dot');
  const contextToggle = document.getElementById('assistant-context-toggle');
  const contextTitle = document.getElementById('assistant-context-title');
  const contextDetail = document.getElementById('assistant-context-detail');
  let conversationId = null;
  let working = false;

  endpointInput.value = endpointValue();

  function refreshContext(question = '') {
    const context = contextToggle.checked ? getStructureContext(question) : null;
    if (context) {
      contextTitle.textContent = context.title;
      const selection = context.selection?.label ? ` · ${context.selection.label}` : '';
      contextDetail.textContent = `${context.format.toUpperCase()} · ${context.atom_count.toLocaleString()} atoms · frame ${context.frame}/${context.frame_count}${selection}`;
    } else {
      contextTitle.textContent = contextToggle.checked ? 'No active structure' : 'Structure context disabled';
      contextDetail.textContent = contextToggle.checked ? 'Load or select an object to attach its metadata.' : 'Questions will use literature evidence only.';
    }
    return context;
  }

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
    refreshContext();
    checkHealth();
    queueMicrotask(() => input.focus());
  }));
  endpointInput.addEventListener('change', saveEndpoint);
  contextToggle.addEventListener('change', () => refreshContext());
  document.getElementById('assistant-retry').addEventListener('click', checkHealth);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || working) return;
    const context = refreshContext(question);
    messages.append(createMessage('user', question, '', context?.title || 'literature only'));
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
        body: JSON.stringify({ question, conversation_id: conversationId, structure_context: context }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Assistant request failed (${response.status})`);
      conversationId = payload.conversation_id;
      pending.replaceWith(createResponse(question, payload, context, onViewerAction, onRecord));
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

  refreshContext();
  checkHealth();
  return {
    refreshContext,
    openForSelection() {
      refreshContext();
      if (!dialog.open) dialog.showModal();
      const context = getStructureContext();
      const selectedLigand = context?.ligands?.find(item => context.selection?.residue_ids?.includes(item.id));
      input.value = selectedLigand
        ? `What role does ${selectedLigand.label.split(' ')[0]} play in ${context.title}?`
        : context?.selection?.label ? `What is known about ${context.selection.label} in ${context.title}?` : 'What is known about this structure?';
      checkHealth();
      queueMicrotask(() => { input.focus(); input.select(); });
    },
  };
}
