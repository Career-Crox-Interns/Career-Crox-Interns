import React from 'react';

function safeText(value, fallback = '') {
  try {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    return JSON.stringify(value) || fallback;
  } catch {
    return fallback;
  }
}

export default class SafeSectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { crashed: true, message: safeText(error?.message, 'Section render failed safely.') };
  }

  componentDidUpdate(prevProps) {
    if (this.state.crashed && prevProps?.resetKey !== this.props?.resetKey) {
      this.setState({ crashed: false, message: '' });
    }
  }

  componentDidCatch(error, info) {
    try {
      console.error('Career Crox safe section guard:', this.props?.title || 'section', error, info);
    } catch {}
  }

  reset = () => {
    this.setState({ crashed: false, message: '' });
  };

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="panel top-gap-small safe-section-fallback">
        <div className="panel-title">{this.props?.title || 'Section recovered'}</div>
        <div className="helper-text top-gap-small">Bad data in this section was blocked, so the full CRM stays alive.</div>
        {this.state.message ? <div className="helper-text top-gap-small">{this.state.message.slice(0, 160)}</div> : null}
        <button type="button" className="ghost-btn bounceable top-gap-small" onClick={this.reset}>Retry Section</button>
      </div>
    );
  }
}
