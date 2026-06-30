import { describe, it, expect } from 'vitest';
import { composeOutputEmail, formatOutputAsText } from './compose-email.js';

const baseParams = {
  toEmail: 'john@sprigly.co.uk',
  fromEmail: 'sprigly@gmail.com',
  workflowId: 'sprigly-blog-post',
  subject: 'Output ready: How AI Is Changing Healthcare',
  bodyText: 'Title: How AI Is Changing Healthcare\r\n\r\nA practical look at how AI tools are reshaping clinical workflows.',
};

describe('composeOutputEmail', () => {
  it('includes the subject in the Subject line', () => {
    const result = composeOutputEmail(baseParams);
    expect(result).toContain(`Subject: ${baseParams.subject}`);
  });

  it('includes the To header', () => {
    const result = composeOutputEmail(baseParams);
    expect(result).toContain(`To: ${baseParams.toEmail}`);
  });

  it('includes the From header', () => {
    const result = composeOutputEmail(baseParams);
    expect(result).toContain(`From: ${baseParams.fromEmail}`);
  });

  it('includes body text', () => {
    const result = composeOutputEmail(baseParams);
    expect(result).toContain(baseParams.bodyText);
  });

  it('includes Content-Type text/plain header', () => {
    const result = composeOutputEmail(baseParams);
    expect(result).toContain('Content-Type: text/plain');
  });
});

describe('formatOutputAsText', () => {
  it('extracts title and body from blog-shaped output', () => {
    const result = formatOutputAsText({ title: 'My Post', body: 'Body text here.' });
    expect(result).toContain('Title: My Post');
    expect(result).toContain('Body text here.');
  });

  it('falls back to JSON for unknown shapes', () => {
    const result = formatOutputAsText({ foo: 'bar' });
    expect(result).toContain('"foo"');
  });

  it('returns string output as-is', () => {
    const result = formatOutputAsText('plain text');
    expect(result).toBe('plain text');
  });
});
