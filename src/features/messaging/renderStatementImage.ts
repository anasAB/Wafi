import type { StatementRow } from './statementText'

export interface RenderStatementImageInput {
  shopName: string
  customerName: string
  periodLabel: string
  rows: StatementRow[]
  balanceUsd: number
  logoDataUrl?: string
}

const FALLBACK_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z3xkAAAAASUVORK5CYII='

function fmtUsd(value: number): string {
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return value < 0 ? `-$${abs}` : `$${abs}`
}

function footerLine(balanceUsd: number): string {
  if (balanceUsd > 0.01) return `الرصيد المستحق: ${fmtUsd(balanceUsd)}`
  if (Math.abs(balanceUsd) <= 0.01) return 'الحساب مسوى'
  return `رصيد لكم: ${fmtUsd(Math.abs(balanceUsd))}`
}

function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image_load_failed'))
    img.src = dataUrl
  })
}

async function renderAtScale(input: RenderStatementImageInput, scale: number): Promise<string> {
  const canvas = document.createElement('canvas')
  const width = Math.max(680, Math.round(780 * scale))
  const rowHeight = Math.max(48, Math.round(56 * scale))
  const padding = Math.max(20, Math.round(28 * scale))
  const headerHeight = Math.max(120, Math.round(150 * scale))
  const footerHeight = Math.max(96, Math.round(112 * scale))
  const bodyHeight = Math.max(120, input.rows.length * rowHeight)
  const height = headerHeight + bodyHeight + footerHeight + padding

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) return FALLBACK_PNG_DATA_URL

  const rtlX = width - padding
  ctx.direction = 'rtl'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'

  // Background
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  // Header bar
  ctx.fillStyle = '#F3F7FF'
  ctx.fillRect(0, 0, width, headerHeight)

  // Header separator
  ctx.strokeStyle = '#D9E4FF'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, headerHeight)
  ctx.lineTo(width, headerHeight)
  ctx.stroke()

  // Optional logo
  if (input.logoDataUrl) {
    try {
      const logo = await imageFromDataUrl(input.logoDataUrl)
      const logoSize = Math.round(48 * scale)
      const logoX = padding
      const logoY = padding
      ctx.drawImage(logo, logoX, logoY, logoSize, logoSize)
    } catch {
      // Ignore logo decode failures to keep statement generation resilient.
    }
  }

  // Title + metadata
  ctx.fillStyle = '#0F172A'
  ctx.font = `${Math.round(24 * scale)}px Tajawal, sans-serif`
  ctx.fillText(input.shopName || 'المحل', rtlX, padding + Math.round(28 * scale))

  ctx.fillStyle = '#1E40AF'
  ctx.font = `${Math.round(18 * scale)}px Tajawal, sans-serif`
  ctx.fillText('كشف حساب عميل', rtlX, padding + Math.round(56 * scale))

  ctx.fillStyle = '#334155'
  ctx.font = `${Math.round(15 * scale)}px Tajawal, sans-serif`
  ctx.fillText(`العميل: ${input.customerName}`, rtlX, padding + Math.round(84 * scale))
  ctx.fillText(`الفترة: ${input.periodLabel}`, rtlX, padding + Math.round(108 * scale))

  // Table header
  const bodyTop = headerHeight + Math.round(22 * scale)
  const dateX = width - padding
  const detailX = Math.round(width * 0.62)
  const amountX = Math.round(width * 0.37)
  const runningX = Math.round(width * 0.2)

  ctx.fillStyle = '#64748B'
  ctx.font = `${Math.round(13 * scale)}px Tajawal, sans-serif`
  ctx.fillText('التاريخ', dateX, bodyTop)
  ctx.fillText('البيان', detailX, bodyTop)
  ctx.fillText('المبلغ', amountX, bodyTop)
  ctx.fillText('الرصيد', runningX, bodyTop)

  let y = bodyTop + Math.round(16 * scale)
  ctx.strokeStyle = '#E5EAF4'
  ctx.beginPath()
  ctx.moveTo(padding, y)
  ctx.lineTo(width - padding, y)
  ctx.stroke()

  // Rows
  ctx.fillStyle = '#0F172A'
  ctx.font = `${Math.round(14 * scale)}px Tajawal, sans-serif`
  input.rows.forEach((row, idx) => {
    y += rowHeight
    if (idx % 2 === 0) {
      ctx.fillStyle = '#FAFCFF'
      ctx.fillRect(padding, y - rowHeight + 6, width - padding * 2, rowHeight - 6)
      ctx.fillStyle = '#0F172A'
    }

    ctx.fillText(row.date || '-', dateX, y - Math.round(20 * scale))
    ctx.fillText(row.label, detailX, y - Math.round(20 * scale))
    ctx.fillText(fmtUsd(row.amountUsd), amountX, y - Math.round(20 * scale))
    ctx.fillText(fmtUsd(row.runningUsd), runningX, y - Math.round(20 * scale))

    ctx.strokeStyle = '#EEF2F7'
    ctx.beginPath()
    ctx.moveTo(padding, y)
    ctx.lineTo(width - padding, y)
    ctx.stroke()
  })

  // Footer
  const footerY = height - footerHeight
  ctx.fillStyle = '#F8FAFC'
  ctx.fillRect(0, footerY, width, footerHeight)
  ctx.strokeStyle = '#E2E8F0'
  ctx.beginPath()
  ctx.moveTo(0, footerY)
  ctx.lineTo(width, footerY)
  ctx.stroke()

  ctx.fillStyle = '#0F172A'
  ctx.font = `${Math.round(18 * scale)}px Tajawal, sans-serif`
  ctx.fillText(footerLine(input.balanceUsd), rtlX, footerY + Math.round(42 * scale))

  ctx.fillStyle = '#64748B'
  ctx.font = `${Math.round(13 * scale)}px Tajawal, sans-serif`
  ctx.fillText('تم التحضير محليا لارساله عبر واتساب', rtlX, footerY + Math.round(72 * scale))

  return canvas.toDataURL('image/png')
}

export async function renderStatementImage(input: RenderStatementImageInput): Promise<string> {
  if (typeof document === 'undefined') return FALLBACK_PNG_DATA_URL

  let dataUrl = await renderAtScale(input, 1)
  // Rough size guard (base64 length -> bytes approx length*3/4).
  if (dataUrl.length > 210_000) dataUrl = await renderAtScale(input, 0.9)
  if (dataUrl.length > 210_000) dataUrl = await renderAtScale(input, 0.8)
  return dataUrl
}
