function pad2(value) { return value < 10 ? `0${value}` : String(value) }

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 使用本地中午计算日期，避免 UTC 解析或夏令时跨日偏移。 */
function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 12)
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day ? date : null
}

/** 指定日期所在自然周：周一至周日。 */
function getNaturalWeek(year, month, day) {
  const anchor = new Date(year, month - 1, day || 1, 12)
  const start = new Date(anchor)
  start.setDate(anchor.getDate() - (anchor.getDay() + 6) % 7)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { startDate: formatLocalDate(start), endDate: formatLocalDate(end) }
}

function getWeekRangeText(startDate, endDate) {
  const start = parseLocalDate(startDate)
  const end = parseLocalDate(endDate)
  if (!start || !end) return ''
  const startText = `${start.getFullYear()}.${start.getMonth() + 1}.${pad2(start.getDate())}`
  const endYear = start.getFullYear() === end.getFullYear() ? '' : `${end.getFullYear()}.`
  return `${startText}–${endYear}${end.getMonth() + 1}.${pad2(end.getDate())}`
}

/** 列出与该月相交的完整自然周，不截断跨月/跨年的首尾周。 */
function getMonthWeeks(year, month, selectedStartDate) {
  const first = getNaturalWeek(year, month, 1)
  const cursor = parseLocalDate(first.startDate)
  const lastDay = new Date(year, month, 0, 12)
  const weeks = []
  while (cursor <= lastDay) {
    const range = getNaturalWeek(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate())
    weeks.push({ ...range, label: getWeekRangeText(range.startDate, range.endDate),
      selected: range.startDate === selectedStartDate })
    cursor.setDate(cursor.getDate() + 7)
  }
  return weeks
}

module.exports = { formatLocalDate, parseLocalDate, getNaturalWeek, getWeekRangeText, getMonthWeeks }
