import { useMemo } from 'react'

/**
 * Lightweight markdown renderer for skill outputs.
 * Supports: headings, bold/italic, code fences, inline code, lists, links, hr, paragraphs.
 */
export function Markdown({ content }: { content: string }) {
  const html = useMemo(() => mdToHtml(content || ''), [content])
  return (
    <div
      className="nj-md text-sm leading-relaxed text-[var(--text)]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s: string): string {
  let t = escapeHtml(s)
  t = t.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="text-[var(--accent-dim)] underline break-all">$1</a>',
  )
  // Autolink bare URLs
  t = t.replace(
    /(?<!["'=])(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer" class="text-[var(--accent-dim)] underline break-all">$1</a>',
  )
  t = t.replace(/`([^`]+)`/g, '<code class="nj-code">$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  return t
}

function mdToHtml(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let inCode = false
  let codeLang = ''
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listType) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>')
      listType = null
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (!inCode) {
        closeList()
        inCode = true
        codeLang = line.slice(3).trim()
        codeBuf = []
      } else {
        out.push(
          `<pre class="nj-pre"><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`,
        )
        inCode = false
        codeBuf = []
      }
      i++
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      i++
      continue
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      closeList()
      out.push('<hr class="nj-hr" />')
      i++
      continue
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      closeList()
      const level = h[1].length
      out.push(`<h${level} class="nj-h${level}">${inline(h[2])}</h${level}>`)
      i++
      continue
    }

    const ul = line.match(/^[-*]\s+(.*)$/)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        listType = 'ul'
        out.push('<ul class="nj-ul">')
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      i++
      continue
    }

    const ol = line.match(/^\d+\.\s+(.*)$/)
    if (ol) {
      if (listType !== 'ol') {
        closeList()
        listType = 'ol'
        out.push('<ol class="nj-ol">')
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      i++
      continue
    }

    if (!line.trim()) {
      closeList()
      i++
      continue
    }

    closeList()
    // gather paragraph
    const paras = [line]
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^#{1,4}\s/.test(lines[i + 1]) && !/^[-*]\s/.test(lines[i + 1]) && !/^\d+\.\s/.test(lines[i + 1]) && !lines[i + 1].startsWith('```') && !/^---+$/.test(lines[i + 1].trim())) {
      i++
      paras.push(lines[i])
    }
    out.push(`<p class="nj-p">${inline(paras.join(' '))}</p>`)
    i++
  }
  closeList()
  if (inCode) {
    out.push(
      `<pre class="nj-pre"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`,
    )
  }
  return out.join('\n')
}
