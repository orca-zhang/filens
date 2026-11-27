import SSF from 'ssf';

export interface DbNumberProfile {
  digits: string;
  places?: string;
  groups?: string;
  bridgeZero?: boolean;
  omitOne?: boolean;
}

const fullwidth = { digits: '０１２３４５６７８９' };
const lower = { digits: '〇一二三四五六七八九', places: ' 十百千', groups: ' 万億兆' };
const simplified: DbNumberProfile[] = [
  { ...lower, groups: ' 万亿兆', bridgeZero: true },
  { digits: '零壹贰叁肆伍陆柒捌玖', places: ' 拾佰仟', groups: ' 万亿兆', bridgeZero: true }, fullwidth
];
const traditional: DbNumberProfile[] = [
  { ...lower, groups: ' 萬億兆', bridgeZero: true },
  { digits: '零壹貳參肆伍陸柒捌玖', places: ' 拾佰仟', groups: ' 萬億兆', bridgeZero: true }, fullwidth
];
const japanese: DbNumberProfile[] = [
  { ...lower, omitOne: true },
  { digits: '零壱弐参四伍六七八九', places: ' 拾百阡', groups: ' 萬億兆' }, fullwidth
];
const korean: DbNumberProfile[] = [
  { ...lower, digits: '零一二三四五六七八九' },
  { digits: '零壹貳參四伍六七八九', places: ' 拾百阡', groups: ' 萬億兆' },
  { ...lower, ...fullwidth, omitOne: true },
  { digits: '영일이삼사오육칠팔구', places: ' 십백천', groups: ' 만억조' }
];

export function dbNumberProfile(locale: string | undefined, kind: number): DbNumberProfile | undefined {
  const tag = locale?.toLowerCase() ?? '';
  const language = tag.split('-')[0];
  if (language === 'ja') return japanese[kind - 1];
  if (language === 'ko') return korean[kind - 1];
  if (language === 'zh') return (/^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(tag) ? traditional : simplified)[kind - 1];
  return undefined;
}

export function formatDbDateField(text: string, profile: DbNumberProfile, locale: string, kind: number, calendarUnit: boolean): string {
  const digits = /^ja(?:-|$)/i.test(locale) && kind === 2 ? '〇' + profile.digits.slice(1) : profile.digits;
  if (calendarUnit && kind !== 3) {
    return formatDbGeneral(Number(text), { ...profile, digits, omitOne: kind === 1 || kind === 4 });
  }
  return text.replace(/\d/g, digit => digits[Number(digit)]);
}

export function formatDbGeneral(value: number, profile: DbNumberProfile): string {
  const { digits, places, groups, bridgeZero, omitOne } = profile;
  // SSF switches General to exponent notation by width, even for exact integers with Excel units.
  const formatted = groups && Number.isSafeInteger(value) && Math.abs(value) < 1e15
    ? String(value) : SSF.format('General', value);
  const localize = (text: string) => text.replace(/\d/g, digit => digits[Number(digit)]);
  const decimal = /^(-?)(\d{1,15})(\.\d+)?$/.exec(formatted);
  if (!decimal || !places || !groups) return localize(formatted);
  const [, sign, whole, fraction = ''] = decimal;
  let integer = '', hasGroup = false, pendingZero = false;
  for (let index = 0; index < whole.length; index++) {
    const exponent = whole.length - index - 1, place = exponent % 4;
    const digit = Number(whole[index]);
    if (digit) {
      if (bridgeZero && pendingZero && integer) integer += digits[0];
      if (digit !== 1 || !place || !omitOne) integer += digits[digit];
      if (place) integer += places[place];
      pendingZero = false;
      hasGroup = true;
    } else {
      pendingZero = true;
    }
    if (!place && hasGroup) {
      if (exponent) integer += groups[exponent / 4];
      hasGroup = false;
      pendingZero = false;
    }
  }
  return sign + (integer || digits[0]) + localize(fraction);
}
