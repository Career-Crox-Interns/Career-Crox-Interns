export const CRM_TIME_ZONE = 'Asia/Kolkata';

const CRM_LOCALE_GUARD_KEY = Symbol.for('career-crox.crm-ist-locale-guard');

export function installCrmIstLocaleGuard() {
  if (typeof Date === 'undefined' || Date.prototype[CRM_LOCALE_GUARD_KEY]) return;

  const patch = (methodName, forceTwelveHour) => {
    const original = Date.prototype[methodName];
    if (typeof original !== 'function') return;
    Object.defineProperty(Date.prototype, methodName, {
      configurable: true,
      writable: true,
      value: function careerCroxIstLocale(locale, options) {
        const safeLocale = locale == null || (Array.isArray(locale) && locale.length === 0) ? 'en-IN' : locale;
        const nextOptions = { ...(options || {}), timeZone: CRM_TIME_ZONE };
        if (forceTwelveHour && nextOptions.hour12 === undefined && nextOptions.hourCycle === undefined) nextOptions.hour12 = true;
        return original.call(this, safeLocale, nextOptions);
      },
    });
  };

  patch('toLocaleString', true);
  patch('toLocaleTimeString', true);
  patch('toLocaleDateString', false);
  Object.defineProperty(Date.prototype, CRM_LOCALE_GUARD_KEY, { value: true, configurable: true });
}


const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: CRM_TIME_ZONE,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: CRM_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: CRM_TIME_ZONE,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

function parseDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value).trim();
  if (!text || text === '-' || text.toLowerCase() === 'n/a') return null;
  let normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? text.replace(' ', 'T') : text;
  // CRM date-time values without an explicit offset are business-time values, so
  // interpret them as IST instead of the viewer/device timezone.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized)) normalized += '+05:30';
  else if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00+05:30';
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCrmDate(value) {
  const date = parseDateInput(value);
  return date ? DATE_FORMATTER.format(date) : '-';
}

export function formatCrmTime(value) {
  const date = parseDateInput(value);
  return date ? TIME_FORMATTER.format(date).toUpperCase() : '-';
}

export function formatCrmDateTime(value) {
  const date = parseDateInput(value);
  if (!date) return '-';
  return `${DATE_FORMATTER.format(date)}, ${TIME_FORMATTER.format(date).toUpperCase()}`;
}

export default formatCrmDateTime;

export function crmDateParts(value = Date.now()) {
  const date = parseDateInput(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CRM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === '24' ? '00' : parts.hour,
    minute: parts.minute,
    second: parts.second,
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function crmTodayYmd() {
  return crmDateParts(Date.now())?.ymd || '';
}

export function crmYmd(value) {
  return crmDateParts(value)?.ymd || '';
}

export function isSameCrmDay(value, base = Date.now()) {
  const valueKey = crmYmd(value);
  const baseKey = crmYmd(base);
  return Boolean(valueKey && baseKey && valueKey === baseKey);
}

export function isTodayCrmDay(value) {
  return isSameCrmDay(value, Date.now());
}

export function toCrmDateTimeLocalInput(value = Date.now()) {
  const parts = crmDateParts(value);
  if (!parts) return '';
  return `${parts.ymd}T${parts.hour}:${parts.minute}`;
}

export function crmDayBoundsUtcIso(ymd = crmTodayYmd()) {
  const match = String(ymd || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (!match) return { start: '', end: '' };
  const [, yy, mm, dd] = match;
  const startMs = Date.parse(`${yy}-${mm}-${dd}T00:00:00.000+05:30`);
  if (!Number.isFinite(startMs)) return { start: '', end: '' };
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

