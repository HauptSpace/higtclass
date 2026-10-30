import { computedRows } from "./aggregate.ts";
import { ledgerOf, rowFlow } from "./ledger.ts";
import type { L10n } from "./templates.ts";
import type { ColumnType, Workspace } from "./types.ts";

// "Для вас": tips and deadlines picked for the person's country and tax
// situation. Everything here is data — a rule pack — so it can be updated on
// the server without shipping a new app. Facts change every year; every item
// links to its source and the app always says "check with your accountant".

export type Country = "DE" | "UA" | "other";
export type Occupation = "personal" | "self" | "company";
export type TaxRegime =
  | "none"
  | "de_klein"
  | "de_ust_monthly"
  | "de_ust_quarterly"
  | "ua_fop1"
  | "ua_fop2"
  | "ua_fop3"
  | "ua_fop3_vat"
  | "ua_general";

/** German federal states, for regional public holidays. */
export type Bundesland = "BW" | "BY" | "BE" | "BB" | "HB" | "HH" | "HE" | "MV" | "NI" | "NW" | "RP" | "SL" | "SN" | "ST" | "SH" | "TH";

export const BUNDESLAENDER: Record<Bundesland, string> = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};

export interface Profile {
  country: Country;
  occupation: Occupation;
  regime: TaxRegime;
  /** Bundesland in Germany. */
  region?: Bundesland;
}

export const REGIMES: Record<Country, TaxRegime[]> = {
  DE: ["de_klein", "de_ust_quarterly", "de_ust_monthly", "none"],
  UA: ["ua_fop1", "ua_fop2", "ua_fop3", "ua_fop3_vat", "ua_general", "none"],
  other: ["none"],
};

export interface When {
  country?: Country[];
  occupation?: Occupation[];
  regime?: TaxRegime[];
}

export interface SuggestedColumn {
  name: L10n;
  type: ColumnType;
  /** `{money}` is replaced by the amount column's name. When the table has a "paid" checkbox the result counts only paid rows. */
  formula?: string;
}

export type SuggestionAction =
  /** Create a table from a template, unless one of `coveredBy` (template ids) already exists. */
  | { type: "template"; templateId: string; coveredBy?: string[] }
  /** Add columns to the income table. */
  | { type: "columns"; columns: SuggestedColumn[] }
  /** @deprecated single-column form from rule pack v1 */
  | { type: "column"; column: SuggestedColumn }
  /** Track income this year against a limit; `hard` is a second, higher ceiling. */
  | { type: "limit"; amount: number; currency: string; hard?: number; note?: L10n }
  /** Progress of savings goals. */
  | { type: "goals" };

export interface Suggestion {
  id: string;
  when: When;
  title: L10n;
  body: L10n;
  source?: string;
  action?: SuggestionAction;
}

export type Schedule =
  | { kind: "monthly"; day: number }
  /** N days after the end of each quarter. */
  | { kind: "quarterly"; daysAfterQuarter: number }
  | { kind: "yearly"; month: number; day: number }
  /** Several fixed dates a year. */
  | { kind: "dates"; dates: { month: number; day: number }[] };

/** Money due for a deadline, worked out from the income booked in the period before it. */
export interface DueAmount {
  label: L10n;
  /** Percent of income; 0 means "show the income itself". */
  rate: number;
}

export interface Deadline {
  id: string;
  when: When;
  title: L10n;
  body: L10n;
  source?: string;
  schedule: Schedule;
  /** A date on Saturday or Sunday moves to Monday. */
  shiftWeekend?: boolean;
  /** Amounts to show next to the deadline, from last quarter's (or month's) income. */
  amounts?: DueAmount[];
}

export interface RulePack {
  version: number;
  updated: string;
  suggestions: Suggestion[];
  deadlines: Deadline[];
}

const tr = (ru: string, uk: string, en: string, de: string, es: string): L10n => ({ ru, uk, en, de, es });

const SRC = {
  ustg19: "https://www.gesetze-im-internet.de/ustg_1980/__19.html",
  ustg18: "https://www.gesetze-im-internet.de/ustg_1980/__18.html",
  ao149: "https://www.gesetze-im-internet.de/ao_1977/__149.html",
  fop3: "https://buhplatforma.com.ua/news/109482-fop-3-grupa-u-2026-rotsi-limity-ta-podatky",
  fopCalendar: "https://buhplatforma.com.ua/news/128232-fop-3-grupa-kalendar-zvitnosti-ta-splaty-podatkiv-za-iii-kvartal-2026-roku-shpargalka",
};

const FOP = ["ua_fop1", "ua_fop2", "ua_fop3", "ua_fop3_vat"] as TaxRegime[];

export const DEFAULT_RULES: RulePack = {
  version: 2,
  updated: "2026-10-30",
  suggestions: [
    {
      id: "de_klein_limit",
      when: { country: ["DE"], regime: ["de_klein"] },
      title: tr("Лимит Kleinunternehmer", "Ліміт Kleinunternehmer", "Kleinunternehmer limit", "Kleinunternehmer-Grenze", "Límite Kleinunternehmer"),
      body: tr(
        "Чтобы и в следующем году работать без НДС, заработайте в этом году не больше 25 000 €. Больше — с 1 января придётся выставлять НДС.",
        "Щоб і наступного року працювати без ПДВ, заробіть цього року не більше 25 000 €. Більше — з 1 січня доведеться виставляти ПДВ.",
        "To stay VAT-free next year, keep this year's income at or below €25,000. Above that you charge VAT from 1 January.",
        "Damit Sie auch nächstes Jahr ohne Umsatzsteuer arbeiten, dürfen Sie dieses Jahr höchstens 25.000 € einnehmen. Darüber berechnen Sie ab 1. Januar Umsatzsteuer.",
        "Para seguir sin IVA el año que viene, no ingreses más de 25.000 € este año. Por encima, cobrarás IVA desde el 1 de enero.",
      ),
      source: SRC.ustg19,
      action: {
        type: "limit",
        amount: 25000,
        currency: "EUR",
        hard: 100000,
        note: tr(
          "Если в этом году больше 100 000 € — НДС сразу, не со следующего года.",
          "Якщо цього року більше 100 000 € — ПДВ одразу, не з наступного року.",
          "Over €100,000 this year means VAT straight away, not from next year.",
          "Über 100.000 € in diesem Jahr: Umsatzsteuer sofort, nicht erst ab nächstem Jahr.",
          "Si superas 100.000 € este año, IVA desde ese momento.",
        ),
      },
    },
    {
      id: "de_vat_column",
      when: { country: ["DE"], regime: ["de_ust_monthly", "de_ust_quarterly"] },
      title: tr("НДС 19% в суммах", "ПДВ 19% у сумах", "19% VAT in your amounts", "19 % USt in den Beträgen", "IVA del 19 % en los importes"),
      body: tr(
        "Колонка посчитает НДС, который сидит внутри суммы. Удобно для Voranmeldung.",
        "Колонка порахує ПДВ, що міститься в сумі. Зручно для Voranmeldung.",
        "A column that works out the VAT contained in each amount. Handy for the Voranmeldung.",
        "Eine Spalte, die die enthaltene Umsatzsteuer berechnet. Praktisch für die Voranmeldung.",
        "Una columna que calcula el IVA incluido en cada importe. Útil para la Voranmeldung.",
      ),
      source: SRC.ustg18,
      action: { type: "columns", columns: [{ name: tr("НДС 19%", "ПДВ 19%", "VAT 19%", "USt 19 %", "IVA 19 %"), type: "formula", formula: "ROUND([{money}] * 19 / 119; 2)" }] },
    },
    {
      id: "de_euer",
      when: { country: ["DE"], occupation: ["self", "company"] },
      title: tr("Доходы и расходы для EÜR", "Доходи та витрати для EÜR", "Income & expenses for the EÜR", "Einnahmen & Ausgaben für die EÜR", "Ingresos y gastos para la EÜR"),
      body: tr(
        "Всё, что нужно Steuerberater в конце года: доходы и расходы по категориям и выгрузка в Excel.",
        "Усе, що потрібно Steuerberater наприкінці року: доходи й витрати за категоріями та вивантаження в Excel.",
        "What your Steuerberater needs at year end: income and costs by category, exported to Excel.",
        "Was Ihr Steuerberater zum Jahresende braucht: Einnahmen und Ausgaben nach Kategorie, als Excel.",
        "Lo que tu asesor necesita a fin de año: ingresos y gastos por categoría, exportados a Excel.",
      ),
      action: { type: "template", templateId: "business", coveredBy: ["business"] },
    },
    {
      id: "de_trips",
      when: { country: ["DE"], occupation: ["self", "company"] },
      title: tr("Поездки на своей машине", "Поїздки власним авто", "Trips in your own car", "Fahrten mit dem eigenen Auto", "Viajes en tu coche"),
      body: tr(
        "30 центов за километр можно списать как расходы. Записывайте поездки — сумма посчитается сама.",
        "30 центів за кілометр можна списати як витрати. Записуйте поїздки — сума порахується сама.",
        "30 cents per kilometre count as a business cost. Log your trips and the amount adds up by itself.",
        "30 Cent pro Kilometer sind Betriebsausgaben. Tragen Sie Fahrten ein — der Betrag rechnet sich selbst.",
        "30 céntimos por kilómetro cuentan como gasto. Anota los viajes y el importe se suma solo.",
      ),
      action: { type: "template", templateId: "trips", coveredBy: ["trips"] },
    },
    {
      id: "ua_fop3_tax",
      when: { country: ["UA"], regime: ["ua_fop3"] },
      title: tr("Налог ФОП: 5% + 1% военный сбор", "Податок ФОП: 5% + 1% військовий збір", "FOP tax: 5% + 1% military levy", "FOP-Steuer: 5 % + 1 % Militärabgabe", "Impuesto FOP: 5 % + 1 % tasa militar"),
      body: tr(
        "Две колонки: единый налог и военный сбор с каждого полученного платежа. Неоплаченные счета не считаются.",
        "Дві колонки: єдиний податок і військовий збір з кожного отриманого платежу. Неоплачені рахунки не рахуються.",
        "Two columns: single tax and military levy on every payment received. Unpaid invoices don't count.",
        "Zwei Spalten: Einheitssteuer und Militärabgabe auf jede erhaltene Zahlung. Offene Rechnungen zählen nicht.",
        "Dos columnas: impuesto único y tasa militar de cada cobro recibido. Las facturas sin cobrar no cuentan.",
      ),
      source: SRC.fop3,
      action: {
        type: "columns",
        columns: [
          { name: tr("Единый налог 5%", "Єдиний податок 5%", "Single tax 5%", "Einheitssteuer 5 %", "Impuesto único 5 %"), type: "formula", formula: "ROUND([{money}] * 5 / 100; 2)" },
          { name: tr("Военный сбор 1%", "Військовий збір 1%", "Military levy 1%", "Militärabgabe 1 %", "Tasa militar 1 %"), type: "formula", formula: "ROUND([{money}] * 1 / 100; 2)" },
        ],
      },
    },
    {
      id: "ua_fop3_vat_tax",
      when: { country: ["UA"], regime: ["ua_fop3_vat"] },
      title: tr("Налог ФОП с НДС: 3% + 1%", "Податок ФОП з ПДВ: 3% + 1%", "FOP with VAT: 3% + 1%", "FOP mit USt: 3 % + 1 %", "FOP con IVA: 3 % + 1 %"),
      body: tr(
        "Колонка посчитает единый налог и военный сбор с каждого дохода.",
        "Колонка порахує єдиний податок і військовий збір з кожного доходу.",
        "A column that works out single tax and military levy for each payment.",
        "Eine Spalte berechnet Einheitssteuer und Militärabgabe je Einnahme.",
        "Una columna que calcula el impuesto único y la tasa militar de cada ingreso.",
      ),
      source: SRC.fop3,
      action: {
        type: "columns",
        columns: [
          { name: tr("Единый налог 3%", "Єдиний податок 3%", "Single tax 3%", "Einheitssteuer 3 %", "Impuesto único 3 %"), type: "formula", formula: "ROUND([{money}] * 3 / 100; 2)" },
          { name: tr("Военный сбор 1%", "Військовий збір 1%", "Military levy 1%", "Militärabgabe 1 %", "Tasa militar 1 %"), type: "formula", formula: "ROUND([{money}] * 1 / 100; 2)" },
        ],
      },
    },
    {
      id: "ua_fop3_limit",
      when: { country: ["UA"], regime: ["ua_fop3", "ua_fop3_vat"] },
      title: tr("Лимит дохода ФОП 3 группы", "Ліміт доходу ФОП 3 групи", "FOP group 3 income limit", "Einkommensgrenze FOP Gruppe 3", "Límite de ingresos FOP grupo 3"),
      body: tr(
        "В 2026 году — 10 091 049 грн. Zifra покажет, сколько осталось до лимита.",
        "У 2026 році — 10 091 049 грн. Zifra покаже, скільки залишилось до ліміту.",
        "10,091,049 UAH in 2026. Zifra shows how much room is left.",
        "2026: 10.091.049 UAH. Zifra zeigt, wie viel noch bleibt.",
        "En 2026: 10.091.049 UAH. Zifra muestra cuánto queda.",
      ),
      source: SRC.fop3,
      action: { type: "limit", amount: 10091049, currency: "UAH" },
    },
    {
      id: "ua_fop_budget",
      when: { country: ["UA"], regime: FOP },
      title: tr("Доходы и расходы ФОП", "Доходи та витрати ФОП", "FOP income & expenses", "FOP Einnahmen & Ausgaben", "Ingresos y gastos FOP"),
      body: tr(
        "Книга учёта доходов в одном месте, с итогами по месяцам и кварталам.",
        "Книга обліку доходів в одному місці, з підсумками за місяцями й кварталами.",
        "Your income book in one place, with monthly and quarterly totals.",
        "Ihr Einnahmenbuch an einem Ort, mit Monats- und Quartalssummen.",
        "Tu libro de ingresos en un solo lugar, con totales por mes y trimestre.",
      ),
      action: { type: "template", templateId: "business", coveredBy: ["business", "clients_payments", "orders", "stock_sales", "team_jobs"] },
    },
    {
      id: "personal_savings",
      when: { occupation: ["personal"] },
      title: tr("Копилка с целью", "Скарбничка з ціллю", "Savings with a goal", "Sparziel", "Hucha con objetivo"),
      body: tr(
        "Записывайте, сколько отложили, и смотрите, сколько осталось до цели.",
        "Записуйте, скільки відклали, і дивіться, скільки лишилось до цілі.",
        "Write down what you put aside and see how close you are.",
        "Notieren Sie, was Sie zurücklegen, und sehen Sie, wie nah das Ziel ist.",
        "Anota lo que apartas y mira cuánto te falta.",
      ),
      action: { type: "template", templateId: "savings", coveredBy: ["savings"] },
    },
    {
      id: "goals",
      when: {},
      title: tr("Ваши цели", "Ваші цілі", "Your goals", "Ihre Ziele", "Tus objetivos"),
      body: tr("Сколько уже отложено и сколько осталось.", "Скільки вже відкладено і скільки лишилось.", "What's put aside and what's left.", "Was schon zurückgelegt ist und was noch fehlt.", "Lo que ya has apartado y lo que falta."),
      action: { type: "goals" },
    },
    {
      id: "personal_expenses",
      when: { occupation: ["personal"] },
      title: tr("Куда уходят деньги", "Куди йдуть гроші", "Where the money goes", "Wohin das Geld geht", "En qué se va el dinero"),
      body: tr(
        "Расходы по категориям и месяцам — сразу видно, на чём можно сэкономить.",
        "Витрати за категоріями й місяцями — одразу видно, на чому можна заощадити.",
        "Spending by category and month shows where you can save.",
        "Ausgaben nach Kategorie und Monat zeigen, wo Sie sparen können.",
        "Gastos por categoría y mes: ves al instante dónde ahorrar.",
      ),
      action: { type: "template", templateId: "expenses", coveredBy: ["expenses", "budget"] },
    },
  ],
  deadlines: [
    {
      id: "de_ust_monthly",
      when: { country: ["DE"], regime: ["de_ust_monthly"] },
      title: tr("USt-Voranmeldung за прошлый месяц", "USt-Voranmeldung за минулий місяць", "VAT return for last month", "USt-Voranmeldung für den Vormonat", "Declaración de IVA del mes anterior"),
      body: tr("Подать в ELSTER и оплатить НДС.", "Подати в ELSTER і сплатити ПДВ.", "File in ELSTER and pay the VAT.", "In ELSTER übermitteln und zahlen.", "Presentar en ELSTER y pagar el IVA."),
      source: SRC.ustg18,
      schedule: { kind: "monthly", day: 10 },
      shiftWeekend: true,
    },
    {
      id: "de_ust_quarterly",
      when: { country: ["DE"], regime: ["de_ust_quarterly"] },
      title: tr("USt-Voranmeldung за квартал", "USt-Voranmeldung за квартал", "Quarterly VAT return", "USt-Voranmeldung für das Quartal", "Declaración trimestral de IVA"),
      body: tr("Подать в ELSTER и оплатить НДС.", "Подати в ELSTER і сплатити ПДВ.", "File in ELSTER and pay the VAT.", "In ELSTER übermitteln und zahlen.", "Presentar en ELSTER y pagar el IVA."),
      source: SRC.ustg18,
      schedule: { kind: "quarterly", daysAfterQuarter: 10 },
      shiftWeekend: true,
    },
    {
      id: "de_est",
      when: { country: ["DE"], occupation: ["self", "company"] },
      title: tr("Налоговая декларация за прошлый год", "Податкова декларація за минулий рік", "Income tax return for last year", "Einkommensteuererklärung für das Vorjahr", "Declaración de la renta del año pasado"),
      body: tr(
        "Срок без налогового консультанта. Со Steuerberater он позже.",
        "Термін без податкового консультанта. Зі Steuerberater він пізніше.",
        "Deadline if you file yourself; with a Steuerberater it is later.",
        "Frist ohne Steuerberater; mit Berater gilt eine spätere Frist.",
        "Plazo si la presentas tú; con asesor es más tarde.",
      ),
      source: SRC.ao149,
      schedule: { kind: "yearly", month: 7, day: 31 },
      shiftWeekend: true,
    },
    {
      id: "de_est_prepayment",
      when: { country: ["DE"], occupation: ["self", "company"] },
      title: tr("Авансовый платёж подоходного налога", "Авансовий платіж податку на дохід", "Income tax prepayment", "Einkommensteuer-Vorauszahlung", "Pago anticipado del impuesto sobre la renta"),
      body: tr(
        "Если налоговая назначила вам Vorauszahlungen — сумма в последнем Bescheid.",
        "Якщо податкова призначила вам Vorauszahlungen — сума в останньому Bescheid.",
        "If the tax office set prepayments for you — the amount is in your latest Bescheid.",
        "Falls das Finanzamt Vorauszahlungen festgesetzt hat — der Betrag steht im letzten Bescheid.",
        "Si Hacienda te fijó pagos anticipados: el importe está en tu última notificación (Bescheid).",
      ),
      source: "https://www.gesetze-im-internet.de/estg/__37.html",
      schedule: { kind: "dates", dates: [{ month: 3, day: 10 }, { month: 6, day: 10 }, { month: 9, day: 10 }, { month: 12, day: 10 }] },
      shiftWeekend: true,
    },
    {
      id: "ua_fop_monthly_tax",
      when: { country: ["UA"], regime: ["ua_fop1", "ua_fop2"] },
      title: tr("Единый налог за этот месяц", "Єдиний податок за цей місяць", "Single tax for this month", "Einheitssteuer für diesen Monat", "Impuesto único de este mes"),
      body: tr("Авансовый платёж ФОП 1–2 группы.", "Авансовий платіж ФОП 1–2 групи.", "Advance payment for FOP groups 1–2.", "Vorauszahlung für FOP Gruppe 1–2.", "Pago anticipado de los grupos FOP 1–2."),
      source: SRC.fopCalendar,
      schedule: { kind: "monthly", day: 20 },
    },
    {
      id: "ua_esv",
      when: { country: ["UA"], regime: FOP },
      title: tr("ЕСВ за квартал", "ЄСВ за квартал", "Social contribution (ESV) for the quarter", "Sozialbeitrag (ESV) für das Quartal", "Contribución social (ESV) del trimestre"),
      body: tr("Единый социальный взнос за себя.", "Єдиний соціальний внесок за себе.", "Your own unified social contribution.", "Ihr eigener Sozialbeitrag.", "Tu contribución social única."),
      source: SRC.fopCalendar,
      schedule: { kind: "quarterly", daysAfterQuarter: 20 },
    },
    {
      id: "ua_fop3_declaration",
      when: { country: ["UA"], regime: ["ua_fop3", "ua_fop3_vat"] },
      title: tr("Декларация ФОП за квартал", "Декларація ФОП за квартал", "FOP quarterly declaration", "FOP-Quartalserklärung", "Declaración trimestral FOP"),
      body: tr("Подать декларацию единщика.", "Подати декларацію платника єдиного податку.", "File the single-tax declaration.", "Einheitssteuererklärung einreichen.", "Presentar la declaración del impuesto único."),
      source: SRC.fopCalendar,
      schedule: { kind: "quarterly", daysAfterQuarter: 40 },
      amounts: [{ label: tr("Доход за квартал", "Дохід за квартал", "Income for the quarter", "Einnahmen im Quartal", "Ingresos del trimestre"), rate: 0 }],
    },
    {
      id: "ua_fop3_payment",
      when: { country: ["UA"], regime: ["ua_fop3"] },
      title: tr("Оплатить налог и военный сбор", "Сплатити податок і військовий збір", "Pay single tax and military levy", "Einheitssteuer und Militärabgabe zahlen", "Pagar impuesto único y tasa militar"),
      body: tr("За прошедший квартал.", "За минулий квартал.", "For the past quarter.", "Für das vergangene Quartal.", "Del trimestre pasado."),
      source: SRC.fopCalendar,
      schedule: { kind: "quarterly", daysAfterQuarter: 50 },
      amounts: [
        { label: tr("Единый налог 5%", "Єдиний податок 5%", "Single tax 5%", "Einheitssteuer 5 %", "Impuesto único 5 %"), rate: 5 },
        { label: tr("Военный сбор 1%", "Військовий збір 1%", "Military levy 1%", "Militärabgabe 1 %", "Tasa militar 1 %"), rate: 1 },
      ],
    },
    {
      id: "ua_fop3_vat_payment",
      when: { country: ["UA"], regime: ["ua_fop3_vat"] },
      title: tr("Оплатить налог и военный сбор", "Сплатити податок і військовий збір", "Pay single tax and military levy", "Einheitssteuer und Militärabgabe zahlen", "Pagar impuesto único y tasa militar"),
      body: tr("За прошедший квартал.", "За минулий квартал.", "For the past quarter.", "Für das vergangene Quartal.", "Del trimestre pasado."),
      source: SRC.fopCalendar,
      schedule: { kind: "quarterly", daysAfterQuarter: 50 },
      amounts: [
        { label: tr("Единый налог 3%", "Єдиний податок 3%", "Single tax 3%", "Einheitssteuer 3 %", "Impuesto único 3 %"), rate: 3 },
        { label: tr("Военный сбор 1%", "Військовий збір 1%", "Military levy 1%", "Militärabgabe 1 %", "Tasa militar 1 %"), rate: 1 },
      ],
    },
  ],
};

export function matches(when: When, profile: Profile): boolean {
  return (
    (!when.country || when.country.includes(profile.country)) &&
    (!when.occupation || when.occupation.includes(profile.occupation)) &&
    (!when.regime || when.regime.includes(profile.regime))
  );
}

export function suggestionsFor(pack: RulePack, profile: Profile): Suggestion[] {
  return pack.suggestions.filter((s) => matches(s.when, profile));
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function shift(d: Date, enabled?: boolean): Date {
  if (!enabled) return d;
  const out = new Date(d);
  while (out.getDay() === 0 || out.getDay() === 6) out.setDate(out.getDate() + 1);
  return out;
}

/** All dates of a schedule between two dates (inclusive). */
function occurrences(schedule: Schedule, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let y = from.getFullYear() - 1; y <= to.getFullYear() + 1; y++) {
    if (schedule.kind === "yearly") out.push(new Date(y, schedule.month - 1, schedule.day));
    else if (schedule.kind === "dates") for (const d of schedule.dates) out.push(new Date(y, d.month - 1, d.day));
    else if (schedule.kind === "monthly") for (let m = 0; m < 12; m++) out.push(new Date(y, m, schedule.day));
    else
      for (const endMonth of [2, 5, 8, 11]) {
        const end = new Date(y, endMonth + 1, 0);
        end.setDate(end.getDate() + schedule.daysAfterQuarter);
        out.push(end);
      }
  }
  return out.filter((d) => d >= from && d <= to);
}

export interface UpcomingDeadline {
  deadline: Deadline;
  date: string;
  daysLeft: number;
}

/**
 * Deadlines from `back` days ago to `days` ahead. Past ones (negative
 * `daysLeft`) stay visible for a week so nobody misses one silently.
 */
export function upcomingDeadlines(pack: RulePack, profile: Profile, today: string, days = 45, back = 0): UpcomingDeadline[] {
  const now = parse(today);
  const from = new Date(now);
  from.setDate(from.getDate() - back);
  const to = new Date(now);
  to.setDate(to.getDate() + days);
  const out: UpcomingDeadline[] = [];
  for (const d of pack.deadlines) {
    if (!matches(d.when, profile)) continue;
    const scanFrom = new Date(from);
    scanFrom.setDate(scanFrom.getDate() - 3); // a weekend shift can move a past date into the window
    for (const raw of occurrences(d.schedule, scanFrom, to)) {
      const date = shift(raw, d.shiftWeekend);
      if (date < from || date > to) continue;
      out.push({ deadline: d, date: iso(date), daysLeft: Math.round((date.getTime() - now.getTime()) / 86_400_000) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function easter(year: number): Date {
  // Anonymous Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export interface Holiday {
  date: string;
  name: string;
}

/** The period a deadline's payment is for: the quarter (or month, year) before it. */
export function deadlinePeriod(deadline: Deadline, date: string): { from: string; to: string } {
  const d = parse(date);
  if (deadline.schedule.kind === "monthly") {
    const a = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return { from: iso(a), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
  }
  if (deadline.schedule.kind === "yearly") return { from: `${d.getFullYear() - 1}-01-01`, to: `${d.getFullYear() - 1}-12-31` };
  // Quarterly: the last quarter that ended before the deadline.
  const q = Math.floor(d.getMonth() / 3);
  const start = new Date(d.getFullYear(), q * 3 - 3, 1);
  return { from: iso(start), to: iso(new Date(start.getFullYear(), start.getMonth() + 3, 0)) };
}

const STATE_HOLIDAYS: { name: string; states: Bundesland[]; date: (year: number, easter: (days: number) => string) => string }[] = [
  { name: "Heilige Drei Könige", states: ["BW", "BY", "ST"], date: (y) => `${y}-01-06` },
  { name: "Internationaler Frauentag", states: ["BE", "MV"], date: (y) => `${y}-03-08` },
  { name: "Fronleichnam", states: ["BW", "BY", "HE", "NW", "RP", "SL"], date: (_, e) => e(60) },
  { name: "Mariä Himmelfahrt", states: ["SL"], date: (y) => `${y}-08-15` },
  { name: "Weltkindertag", states: ["TH"], date: (y) => `${y}-09-20` },
  { name: "Reformationstag", states: ["BB", "HB", "HH", "MV", "NI", "SN", "ST", "SH", "TH"], date: (y) => `${y}-10-31` },
  { name: "Allerheiligen", states: ["BW", "BY", "NW", "RP", "SL"], date: (y) => `${y}-11-01` },
  {
    name: "Buß- und Bettag",
    states: ["SN"],
    // The Wednesday before 23 November.
    date: (y) => {
      const d = new Date(y, 10, 22);
      while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
      return iso(d);
    },
  },
];

/** Public holidays in Germany (banks and offices closed): nationwide, plus the state's own when known. */
export function germanHolidays(year: number, state?: Bundesland): Holiday[] {
  const e = easter(year);
  const plus = (days: number) => {
    const d = new Date(e);
    d.setDate(d.getDate() + days);
    return iso(d);
  };
  return [
    { date: `${year}-01-01`, name: "Neujahr" },
    { date: plus(-2), name: "Karfreitag" },
    { date: plus(1), name: "Ostermontag" },
    { date: `${year}-05-01`, name: "Tag der Arbeit" },
    { date: plus(39), name: "Christi Himmelfahrt" },
    { date: plus(50), name: "Pfingstmontag" },
    { date: `${year}-10-03`, name: "Tag der Deutschen Einheit" },
    { date: `${year}-12-25`, name: "1. Weihnachtstag" },
    { date: `${year}-12-26`, name: "2. Weihnachtstag" },
    ...(state ? STATE_HOLIDAYS.filter((h) => h.states.includes(state)).map((h) => ({ name: h.name, date: h.date(year, plus) })) : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function upcomingHolidays(profile: Profile, today: string, days = 45): (Holiday & { daysLeft: number })[] {
  if (profile.country !== "DE") return [];
  const from = parse(today);
  const to = new Date(from);
  to.setDate(to.getDate() + days);
  return [...germanHolidays(from.getFullYear(), profile.region), ...germanHolidays(from.getFullYear() + 1, profile.region)]
    .filter((h) => parse(h.date) >= from && parse(h.date) <= to)
    .map((h) => ({ ...h, daysLeft: Math.round((parse(h.date).getTime() - from.getTime()) / 86_400_000) }));
}

/** Basic shape check for a rule pack fetched from the server. */
export function isRulePack(x: unknown): x is RulePack {
  const p = x as RulePack;
  return !!p && typeof p.version === "number" && Array.isArray(p.suggestions) && Array.isArray(p.deadlines);
}

/**
 * Income received between two dates across every table that holds income
 * (its ledger), counting only paid rows. Used for limits and tax amounts.
 */
export function incomeBetween(ws: Workspace, from: string, to: string, today: string): { total: number; tables: string[] } {
  let total = 0;
  const tables: string[] = [];
  for (const t of ws.tables) {
    const ledger = ledgerOf(t);
    if (!ledger || ledger.kind === "expense") continue;
    const date = t.columns.find((c) => c.type === "date");
    const paidDate = t.columns.find((c) => c.id === ledger.dateColumnId);
    const values = computedRows(t, today, ws);
    let used = false;
    for (const v of values) {
      // The day the money arrived, if the table records it.
      const d = (paidDate && v[paidDate.id]) || (date ? v[date.id] : null);
      if (date && (typeof d !== "string" || d < from || d > to)) continue;
      const f = rowFlow(ledger, v);
      if (f.income) {
        total += f.income;
        used = true;
      }
    }
    if (used || t.rows.length === 0) tables.push(t.name);
  }
  return { total, tables };
}

/** Income booked this calendar year, for limit trackers. */
export function incomeThisYear(ws: Workspace, today: string): { total: number; tables: string[] } {
  const year = today.slice(0, 4);
  return incomeBetween(ws, `${year}-01-01`, `${year}-12-31`, today);
}
