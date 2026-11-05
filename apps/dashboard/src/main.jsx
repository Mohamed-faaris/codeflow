import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const DEFAULT_API = 'http://127.0.0.1:4317';

function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API);
  const [apiToken, setApiToken] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState([]);
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [tab, setTab] = useState('chat');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [findings, setFindings] = useState([]);
  const [useAI, setUseAI] = useState(true);
  const [filePath, setFilePath] = useState('');
  const [instructions, setInstructions] = useState('');
  const [proposal, setProposal] = useState(null);

  const configuredProviders = useMemo(() => providers.filter((item) => item.configured), [providers]);

  async function api(path, options = {}) {
    const response = await fetch(apiUrl.replace(/\/+$/, '') + path, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(apiToken ? { authorization: 'Bearer ' + apiToken } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'API request failed (' + response.status + ')');
    return data;
  }

  async function refresh() {
    const [providerData, projectData] = await Promise.all([api('/api/providers'), api('/api/projects')]);
    setProviders(providerData.providers || []);
    setProjects(projectData.projects || []);
    if (!providerData.providers?.some((item) => item.id === provider)) {
      setProvider(providerData.defaultProvider || 'openai');
    }
  }

  useEffect(() => { refresh().catch((err) => setError(err.message)); }, []);

  async function withBusy(task, successMessage) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await task();
      if (successMessage) setNotice(successMessage);
      return result;
    } catch (err) {
      setError(err.message || 'Operation failed');
      return null;
    } finally { setBusy(false); }
  }

  async function connectProject(event) {
    event.preventDefault();
    const result = await withBusy(async () => {
      const data = await api('/api/projects', { method: 'POST', body: JSON.stringify({ rootPath: projectPath }) });
      setProject(data.project); setMessages([]); setSessionId(null); setProposal(null);
      const indexed = await api('/api/projects/' + data.project.id + '/index', { method: 'POST', body: '{}' });
      await refresh();
      return indexed.indexing;
    });
    if (result) setNotice('Indexed ' + result.indexedFiles + ' files and ' + result.indexedChunks + ' chunks.');
  }

  function selectProject(id) {
    const chosen = projects.find((item) => item.id === id);
    if (!chosen) return;
    setProject(chosen); setMessages([]); setSessionId(null); setProposal(null); setFindings([]);
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!project || !chatInput.trim()) return;
    const question = chatInput.trim();
    setChatInput('');
    setMessages((current) => [...current, { role: 'user', content: question }]);
    const result = await withBusy(async () => {
      const data = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ projectId: project.id, sessionId: sessionId || undefined, question, provider, model: model || undefined })
      });
      setSessionId(data.sessionId);
      setMessages((current) => [...current, { role: 'assistant', content: data.answer, citations: data.citations || [], provider: data.provider, model: data.model }]);
      return data;
    });
    if (!result) setMessages((current) => current.slice(0, -1));
  }

  async function runAudit() {
    if (!project) return;
    const data = await withBusy(() => api('/api/security/audit', {
      method: 'POST', body: JSON.stringify({ projectId: project.id, useAI, provider, model: model || undefined })
    }), 'Security audit completed.');
    if (data) setFindings(data.audit.findings || []);
  }

  async function loadFindings() {
    if (!project) return;
    const data = await withBusy(() => api('/api/security/' + project.id + '/findings'));
    if (data) setFindings(data.findings || []);
  }

  async function propose() {
    if (!project) return;
    const data = await withBusy(() => api('/api/refactoring/proposals', {
      method: 'POST',
      body: JSON.stringify({ projectId: project.id, filePath, instructions, provider, model: model || undefined })
    }), 'Proposal generated. No files have been changed.');
    if (data) setProposal(data.proposal);
  }

  async function approveAndApply() {
    if (!project || !proposal) return;
    const result = await withBusy(async () => {
      await api('/api/refactoring/' + proposal.id + '/approve', { method: 'POST', body: JSON.stringify({ projectId: project.id }) });
      return api('/api/refactoring/' + proposal.id + '/apply', { method: 'POST', body: JSON.stringify({ projectId: project.id }) });
    }, 'Approved refactor applied.');
    if (result) setProposal((current) => ({ ...current, status: 'applied' }));
  }

  const chatView = <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">REPOSITORY INTELLIGENCE</p><h2>Chat with your codebase</h2><p className="muted">Answers are grounded in indexed files and include source references.</p></div><button className="button subtle" onClick={() => { setMessages([]); setSessionId(null); }}>New chat</button></div>
    <div className="messages">
      {messages.length === 0 && <div className="empty-state"><div className="empty-icon">⌘</div><h3>Ask about this repository</h3><p>Try: “Trace the authentication flow” or “Which modules depend on the database layer?”</p></div>}
      {messages.map((message, index) => <article className={'message ' + message.role} key={index}>
        <div className="message-role">{message.role === 'assistant' ? 'CODEFLOW AI' : 'YOU'}</div>
        <pre>{message.content}</pre>
        {message.citations?.length > 0 && <div className="citations">{message.citations.map((citation, i) => <span className="citation" key={i}>{citation.path}:{citation.startLine}-{citation.endLine}</span>)}</div>}
        {message.model && <div className="message-meta">{message.provider} · {message.model}</div>}
      </article>)}
    </div>
    <form className="composer" onSubmit={sendMessage}>
      <textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask a question about this codebase…" rows="3" />
      <div className="composer-footer"><span className="muted small">Repository source is treated as untrusted context.</span><button className="button primary" disabled={busy || !project || !chatInput.trim()}>Send question</button></div>
    </form>
  </section>;

  const securityView = <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">DEFENSIVE ANALYSIS</p><h2>AI Security Auditor</h2><p className="muted">Combines CodeFlow static findings with evidence-based AI review.</p></div><div className="actions"><button className="button subtle" onClick={loadFindings} disabled={!project || busy}>Load saved</button><button className="button primary" onClick={runAudit} disabled={!project || busy}>Run audit</button></div></div>
    <label className="toggle"><input type="checkbox" checked={useAI} onChange={(event) => setUseAI(event.target.checked)} /> Add AI verification and remediation suggestions</label>
    <div className="finding-list">
      {findings.length === 0 && <div className="empty-state compact"><h3>No findings loaded</h3><p>Run an audit to inspect static and AI-reviewed findings.</p></div>}
      {findings.map((finding, index) => <article className="finding" key={finding.id || index}>
        <div className="finding-top"><span className={'severity ' + String(finding.severity || 'info').toLowerCase()}>{finding.severity || 'info'}</span><strong>{finding.title || finding.category}</strong><span className="muted small">{finding.path || finding.file}:{finding.line || '?'}</span></div>
        <p>{finding.description}</p>
        {finding.aiReview && <div className="review-note"><strong>AI assessment: {finding.aiReview.validity}</strong><p>{finding.aiReview.reason}</p>{finding.aiReview.fix && <p><strong>Suggested remediation:</strong> {finding.aiReview.fix}</p>}</div>}
      </article>)}
    </div>
  </section>;

  const refactorView = <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">HUMAN-APPROVED CHANGES</p><h2>AI Refactoring Assistant</h2><p className="muted">Generate a single-file proposal. Nothing changes until you approve and apply it.</p></div></div>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); propose(); }}>
      <label>Repository file path<input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="src/services/auth.ts" required /></label>
      <label>Refactoring instruction<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Extract token validation into a reusable function without changing behavior." rows="4" required /></label>
      <button className="button primary" disabled={busy || !project}>Generate proposal</button>
    </form>
    {proposal && <div className="proposal">
      <div className="proposal-head"><div><span className={'status ' + proposal.status}>{proposal.status}</span><h3>{proposal.summary}</h3></div><span className="muted small">{proposal.file_path}</span></div>
      <pre className="diff">{proposal.unified_diff}</pre>
      {proposal.status === 'pending' && <div className="approval-row"><span className="muted small">Review the complete diff before approval.</span><button className="button primary" onClick={approveAndApply} disabled={busy}>Approve & apply</button></div>}
      {proposal.status === 'applied' && <p className="success-text">Applied. Run your project tests to verify behavior.</p>}
    </div>}
  </section>;

  const settingsView = <section className="panel">
    <p className="eyebrow">CONNECTIONS</p><h2>AI settings</h2>
    <div className="form-grid settings-grid">
      <label>API base URL<input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} /></label>
      <label>API access token <span className="muted small">(kept in this tab only)</span><input type="password" value={apiToken} onChange={(event) => setApiToken(event.target.value)} placeholder="Optional CODEFLOW_API_TOKEN" /></label>
      <label>Default provider<select value={provider} onChange={(event) => { setProvider(event.target.value); setModel(''); }}>{providers.map((item) => <option key={item.id} value={item.id}>{item.id}{item.configured ? '' : ' (not configured)'}</option>)}</select></label>
      <label>Model override<input value={model} onChange={(event) => setModel(event.target.value)} placeholder={providers.find((item) => item.id === provider)?.model || 'Use provider default'} /></label>
    </div>
    <div className="provider-list"><h3>Provider availability</h3>{providers.map((item) => <div className="provider-row" key={item.id}><strong>{item.id}</strong><span className={item.configured ? 'online' : 'offline'}>{item.configured ? 'Configured' : 'Needs environment configuration'}</span><span className="muted small">{item.model || 'No model set'}</span></div>)}</div>
    <p className="muted small">Provider API keys are read by the server from environment variables. They are not sent to this browser or saved in PostgreSQL.</p>
    <button className="button subtle" onClick={() => withBusy(refresh)}>Refresh settings</button>
  </section>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">CF</span><div><strong>CodeFlow</strong><small>AI WORKSPACE</small></div></div>
      <div className="sidebar-label">WORKSPACE</div>
      {[['chat','◌','Codebase chat'],['security','◇','Security auditor'],['refactor','⌁','Refactoring']].map(([id,icon,label]) =>
        <button key={id} className={'nav-item ' + (tab === id ? 'active' : '')} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}
      <div className="sidebar-label settings-label">CONFIGURATION</div>
      <button className={'nav-item ' + (tab === 'settings' ? 'active' : '')} onClick={() => setTab('settings')}><span>⚙</span>AI settings</button>
      <div className="sidebar-bottom"><span className="status-dot" />Local API · {apiUrl.replace(/^https?:\/\//, '')}</div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="muted small">CODEFLOW / AI</span><h1>{project?.name || 'AI workspace'}</h1></div><div className="top-controls">
        {projects.length > 0 && <select value={project?.id || ''} onChange={(event) => selectProject(event.target.value)}><option value="">Select project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        <span className="provider-chip">{provider}</span>
      </div></header>
      <section className="connect-bar"><form onSubmit={connectProject} className="connect-form"><div><label htmlFor="project-path">Local repository path</label><input id="project-path" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="/home/you/Projects/my-app" required /></div><button className="button primary" disabled={busy}>Connect & index</button></form>
        {project && <div className="project-meta"><span className="status online">Indexed project</span><code>{project.root_path}</code></div>}
      </section>
      {error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
      {!project && tab !== 'settings' && <div className="welcome"><div className="welcome-mark">CF</div><p className="eyebrow">REPOSITORY-AWARE AI</p><h2>Understand your codebase.<br/>Improve it with evidence.</h2><p className="muted">Connect a local repository to start chatting, auditing security and generating safe refactoring proposals.</p></div>}
      {project && tab === 'chat' && chatView}
      {project && tab === 'security' && securityView}
      {project && tab === 'refactor' && refactorView}
      {tab === 'settings' && settingsView}
      <footer>CodeFlow AI · Source-grounded analysis · Human-approved refactoring</footer>
    </main>
    {busy && <div className="busy-indicator"><span className="spinner" /> Processing repository request…</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
