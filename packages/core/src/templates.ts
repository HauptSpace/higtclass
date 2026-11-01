import { createTable, type ColumnDraft, type CommandContext, type LedgerDraft } from "./commands.ts";
import { findColumnByName } from "./formula.ts";
import type { Op } from "./ops.ts";
import type { Locale, RollupAgg, Table } from "./types.ts";

// Ready-made starting points, so nobody faces an empty sheet.
// Every name is translated; formulas are built from the translated names.
// Each template also says what it does for you and when to pick it,
// which is what the onboarding shows. Some templates are several linked
// tables at once (stock + sales, clients + payments), wired up already.

export type L10n = Record<Locale, string>;

const tr = (ru: string, uk: string, en: string, de: string, es: string): L10n => ({ ru, uk, en, de, es });

const N = {
  date: tr("Дата", "Дата", "Date", "Datum", "Fecha"),
  amount: tr("Сумма", "Сума", "Amount", "Betrag", "Importe"),
  note: tr("Комментарий", "Коментар", "Note", "Notiz", "Nota"),
  category: tr("Категория", "Категорія", "Category", "Kategorie", "Categoría"),
  type: tr("Тип", "Тип", "Type", "Art", "Tipo"),
  item: tr("Товар", "Товар", "Item", "Artikel", "Artículo"),
  sku: tr("Артикул", "Артикул", "SKU", "Artikelnr.", "Referencia"),
  qty: tr("Количество", "Кількість", "Quantity", "Menge", "Cantidad"),
  price: tr("Цена", "Ціна", "Price", "Preis", "Precio"),
  cost: tr("Закупка", "Закупівля", "Cost price", "Einkaufspreis", "Coste"),
  received: tr("Поступило", "Надійшло", "Received", "Zugang", "Entradas"),
  sold: tr("Продано", "Продано", "Sold", "Verkauft", "Vendido"),
  stock: tr("Остаток", "Залишок", "In stock", "Bestand", "Stock"),
  revenue: tr("Выручка", "Виручка", "Revenue", "Umsatz", "Ingresos"),
  margin: tr("Маржа", "Маржа", "Margin", "Marge", "Margen"),
  discount: tr("Скидка", "Знижка", "Discount", "Rabatt", "Descuento"),
  channel: tr("Канал", "Канал", "Channel", "Kanal", "Canal"),
  supplier: tr("Поставщик", "Постачальник", "Supplier", "Lieferant", "Proveedor"),
  total: tr("Итого", "Разом", "Total", "Summe", "Total"),
  client: tr("Клиент", "Клієнт", "Client", "Kunde", "Cliente"),
  name: tr("Имя", "Ім'я", "Name", "Name", "Nombre"),
  title: tr("Название", "Назва", "Name", "Name", "Nombre"),
  company: tr("Компания", "Компанія", "Company", "Firma", "Empresa"),
  phone: tr("Телефон", "Телефон", "Phone", "Telefon", "Teléfono"),
  city: tr("Город", "Місто", "City", "Ort", "Ciudad"),
  address: tr("Адрес", "Адреса", "Address", "Adresse", "Dirección"),
  contact: tr("Контакт", "Контакт", "Contact", "Ansprechpartner", "Contacto"),
  status: tr("Статус", "Статус", "Status", "Status", "Estado"),
  paid: tr("Оплачено", "Оплачено", "Paid", "Bezahlt", "Pagado"),
  service: tr("Услуга", "Послуга", "Service", "Leistung", "Servicio"),
  received_total: tr("Получено", "Отримано", "Received", "Erhalten", "Cobrado"),
  debt: tr("Долг", "Борг", "Owes", "Offen", "Pendiente"),
  paidOn: tr("Дата оплаты", "Дата оплати", "Paid on", "Bezahlt am", "Fecha de cobro"),
  task: tr("Задача", "Завдання", "Task", "Aufgabe", "Tarea"),
  job: tr("Работа", "Робота", "Job", "Auftrag", "Trabajo"),
  worker: tr("Исполнитель", "Виконавець", "Assigned to", "Mitarbeiter", "Asignado a"),
  hours: tr("Часы", "Години", "Hours", "Stunden", "Horas"),
  rate: tr("Ставка в час", "Ставка за годину", "Hourly rate", "Stundensatz", "Tarifa por hora"),
  fee: tr("Абонплата", "Абонплата", "Monthly fee", "Monatspauschale", "Cuota mensual"),
  active: tr("Работает", "Працює", "Active", "Aktiv", "Activo"),
  owner: tr("Ответственный", "Відповідальний", "Owner", "Zuständig", "Responsable"),
  due: tr("Срок", "Термін", "Due", "Fällig", "Fecha límite"),
  done: tr("Готово", "Готово", "Done", "Erledigt", "Hecho"),
  who: tr("Кто", "Хто", "Who", "Wer", "Quién"),
  direction: tr("Кто должен", "Хто винен", "Who owes", "Wer schuldet", "Quién debe"),
  returned: tr("Вернули", "Повернули", "Settled", "Beglichen", "Devuelto"),
  lastContact: tr("Последний контакт", "Останній контакт", "Last contact", "Letzter Kontakt", "Último contacto"),
  counterparty: tr("Кому / от кого", "Кому / від кого", "Paid to / from", "Kunde / Lieferant", "A quién / de quién"),
  route: tr("Маршрут", "Маршрут", "Route", "Strecke", "Ruta"),
  purpose: tr("Цель поездки", "Мета поїздки", "Purpose", "Zweck", "Motivo"),
  km: tr("Км", "Км", "km", "km", "km"),
  receipt: tr("Чек", "Чек", "Receipt", "Beleg", "Recibo"),
  allowance: tr("Возмещение", "Відшкодування", "Allowance", "Pauschale", "Importe"),
};

const opts = (...items: L10n[]) => (l: Locale) => items.map((i) => i[l]);

const INCOME = tr("Доход", "Дохід", "Income", "Einnahme", "Ingreso");
const DONE = tr("Готово", "Готово", "Done", "Erledigt", "Hecho");
const EXPENSE = tr("Расход", "Витрата", "Expense", "Ausgabe", "Gasto");

/**
 * Categories with the words people use for them, so "кава 85" or "Taxi 450"
 * lands in the right category without the assistant.
 */
export interface CategoryDef {
  name: L10n;
  words: RegExp;
}

const cat = (name: L10n, words: RegExp): CategoryDef => ({ name, words });

export const PERSONAL_EXPENSES: CategoryDef[] = [
  cat(tr("Еда", "Їжа", "Food", "Essen", "Comida"), /(еда|ед[уы]|продукт|кофе|ко?ф[еу]|кав[аиуіо]|кафе|обед|обід|ужин|вечер|ресторан|магазин|сільпо|атб|novus|пицц|піц|шаурм|хлеб|хліб|молок|groceries|food|coffee|lunch|dinner|restaurant|supermarket|lebensmittel|essen|kaffee|rewe|lidl|aldi|edeka|comida|café|cafe|cena|almuerzo|super|mercadona)/i),
  cat(tr("Транспорт", "Транспорт", "Transport", "Transport", "Transporte"), /(такси|таксі|taxi|uber|bolt|uklon|уклон|метро|автобус|маршрутк|бензин|топлив|пальн|заправ|парков|поезд|потяг|квиток|билет|fuel|petrol|gas station|bus|train|ticket|parking|benzin|tanken|bahn|ticket|gasolina|tren|aparcamiento)/i),
  cat(tr("Дом", "Дім", "Home", "Wohnen", "Casa"), /(квартир|аренд|оренд|комунал|коммунал|свет|світло|газ|вода|ремонт|rent|electric|utilities|miete|strom|nebenkosten|alquiler|luz|agua)/i),
  cat(tr("Связь", "Зв'язок", "Phone & internet", "Telefon & Internet", "Teléfono e internet"), /(связь|зв.язок|телефон|мобильн|мобільн|интернет|інтернет|київстар|киевстар|vodafone|lifecell|phone|internet|mobile|handy|telekom|o2|teléfono|movistar)/i),
  cat(tr("Здоровье", "Здоров'я", "Health", "Gesundheit", "Salud"), /(аптек|лекарств|ліки|врач|лікар|стоматолог|анализ|аналіз|pharmacy|doctor|dentist|apotheke|arzt|farmacia|médico|dentista)/i),
  cat(tr("Развлечения", "Розваги", "Fun", "Freizeit", "Ocio"), /(кино|кіно|театр|концерт|бар|клуб|игр|ігр|netflix|spotify|cinema|movie|bar|games|kino|freizeit|cine|ocio)/i),
  cat(tr("Другое", "Інше", "Other", "Sonstiges", "Otros"), /^$/),
];

export const PERSONAL_INCOME: CategoryDef[] = [
  cat(tr("Зарплата", "Зарплата", "Salary", "Gehalt", "Sueldo"), /(зарплат|зп|аванс|преми|премі|бонус|кешбек|cashback|salary|wage|payday|bonus|gehalt|lohn|prämie|sueldo|nómina|nomina|paga extra)/i),
  cat(tr("Подработка", "Підробіток", "Side job", "Nebenjob", "Extra"), /(подработ|підробіт|халтур|фриланс|freelance|side|nebenjob|extra)/i),
  // Only gifts received: "подарунок мамі" is spending.
  cat(tr("Подарок", "Подарунок", "Gift", "Geschenk", "Regalo"), /(подарили|подарували|подарок от|подарунок від|gift from|got a gift|geschenk von|geschenkt bekommen|regalo de|me regalaron)/i),
  cat(tr("Другой доход", "Інший дохід", "Other income", "Sonstige Einnahme", "Otro ingreso"), /^$/),
];

export const BUSINESS_EXPENSES: CategoryDef[] = [
  cat(tr("Материалы и товар", "Матеріали й товар", "Materials & goods", "Material & Waren", "Material y mercancía"), /(материал|матеріал|товар|закуп|material|waren|einkauf|baumarkt|obi|hornbach|stock|mercanc)/i),
  cat(tr("Инструмент и техника", "Інструмент і техніка", "Tools & equipment", "Werkzeug & Geräte", "Herramientas y equipos"), /(инструмент|інструмент|дрель|дриль|ноутбук|компьютер|комп.ютер|техник|техніка|tool|laptop|equipment|werkzeug|gerät|bohrer|herramient|equipo)/i),
  cat(tr("Авто и топливо", "Авто й пальне", "Car & fuel", "Kfz & Kraftstoff", "Coche y combustible"), /(бензин|топлив|пальн|заправ|дизел|авто|машин|ремонт авто|парков|fuel|petrol|diesel|car|parking|tanken|benzin|kfz|werkstatt|gasolina|coche)/i),
  cat(tr("Поездки", "Поїздки", "Travel", "Reisekosten", "Viajes"), /(такси|таксі|taxi|uber|bolt|поезд|потяг|билет|квиток|авиа|самол|літак|hotel|отель|готел|bahn|zug|flug|ticket|train|flight|tren|vuelo|billete)/i),
  cat(tr("Связь и интернет", "Зв'язок та інтернет", "Phone & internet", "Telefon & Internet", "Teléfono e internet"), /(связь|зв.язок|телефон|интернет|інтернет|phone|internet|handy|telekom|vodafone|o2|teléfono)/i),
  cat(tr("Программы и сервисы", "Програми й сервіси", "Software & services", "Software & Dienste", "Software y servicios"), /(подписк|підписк|софт|програм|сервис|сервіс|хостинг|домен|software|subscription|hosting|domain|abo|lizenz|suscripci)/i),
  cat(tr("Аренда", "Оренда", "Rent", "Miete & Raum", "Alquiler"), /(аренд|оренд|офис|офіс|склад|rent|office|miete|büro|lager|alquiler|oficina)/i),
  cat(tr("Реклама", "Реклама", "Advertising", "Werbung", "Publicidad"), /(реклам|таргет|ads|advert|marketing|werbung|anzeige|publicidad)/i),
  cat(tr("Страховки", "Страховки", "Insurance", "Versicherungen", "Seguros"), /(страхов|insurance|versicherung|seguro)/i),
  cat(tr("Налоги и взносы", "Податки й внески", "Taxes & contributions", "Steuern & Beiträge", "Impuestos y cuotas"), /(налог|податок|податк|есв|єсв|взнос|внесок|(^|\s)tax(es)?(\s|$)|finanzamt|steuer|beitrag|impuesto|cuota)/i),
  cat(tr("Прочие расходы", "Інші витрати", "Other costs", "Sonstige Ausgaben", "Otros gastos"), /^$/),
];

export const BUSINESS_INCOME: CategoryDef[] = [
  cat(tr("Услуги", "Послуги", "Services", "Dienstleistungen", "Servicios"), /(услуг|послуг|работ|робот|заказ|замовлен|монтаж|сборк|збірк|ремонт|дизайн|консульт|урок|уборк|прибиран|service|job|montage|aufbau|reparatur|installation|beratung|unterricht|reinigung|auftrag|leistung|honorar|rechnung|design|consult|lesson|cleaning|invoice|servicio|trabajo|limpieza|factura)/i),
  cat(tr("Продажи", "Продажі", "Sales", "Verkauf", "Ventas"), /(продаж|продал|sale|sold|verkauf|venta)/i),
  cat(tr("Прочий доход", "Інший дохід", "Other income", "Sonstige Einnahmen", "Otros ingresos"), /^$/),
];

export const ALL_CATEGORIES: CategoryDef[] = [...PERSONAL_EXPENSES, ...PERSONAL_INCOME, ...BUSINESS_EXPENSES, ...BUSINESS_INCOME];

/** A category column whose choices depend on the Type: income categories for income, the rest for expenses. */
function categoryColumn(l: Locale, income: CategoryDef[], expense: CategoryDef[]): ColumnDraft {
  const map: Record<string, string> = {};
  for (const c of income) map[c.name[l]] = INCOME[l];
  for (const c of expense) map[c.name[l]] = EXPENSE[l];
  return {
    name: N.category[l],
    type: "select",
    options: [...expense, ...income].map((c) => c.name[l]),
    scope: { column: N.type[l], map },
  };
}

function typeColumn(l: Locale): ColumnDraft {
  return { name: N.type[l], type: "select", options: [INCOME[l], EXPENSE[l]], default: EXPENSE[l], optionColors: { [INCOME[l]]: "var(--paid)" } };
}

/** What the person told the onboarding they want Sumira for. */
export type UseCase = "personal" | "trade" | "services" | "team" | "finance" | "other";

export const USE_CASES: { id: UseCase; icon: string; name: L10n; hint: L10n }[] = [
  {
    id: "personal",
    icon: "◐",
    name: tr("Личные деньги", "Особисті гроші", "Personal money", "Private Finanzen", "Dinero personal"),
    hint: tr(
      "Копить, считать расходы, помнить долги",
      "Накопичувати, рахувати витрати, пам'ятати борги",
      "Save up, track spending, remember debts",
      "Sparen, Ausgaben zählen, Schulden im Blick",
      "Ahorrar, controlar gastos, recordar deudas",
    ),
  },
  {
    id: "trade",
    icon: "▤",
    name: tr("Торговля и склад", "Торгівля та склад", "Sales & stock", "Handel & Lager", "Ventas y stock"),
    hint: tr(
      "Товары, остатки, заказы, поставщики",
      "Товари, залишки, замовлення, постачальники",
      "Products, stock levels, orders, suppliers",
      "Artikel, Bestände, Bestellungen, Lieferanten",
      "Productos, existencias, pedidos, proveedores",
    ),
  },
  {
    id: "services",
    icon: "◎",
    name: tr("Услуги и клиенты", "Послуги та клієнти", "Services & clients", "Dienstleistung & Kunden", "Servicios y clientes"),
    hint: tr(
      "Клиенты, заказы, оплаты, кто что ведёт",
      "Клієнти, замовлення, оплати, хто що веде",
      "Clients, jobs, payments, who handles what",
      "Kunden, Aufträge, Zahlungen, wer was betreut",
      "Clientes, encargos, cobros, quién lleva qué",
    ),
  },
  {
    id: "team",
    icon: "▦",
    name: tr("Команда и задачи", "Команда та завдання", "Team & tasks", "Team & Aufgaben", "Equipo y tareas"),
    hint: tr(
      "Кто что делает и к какому сроку",
      "Хто що робить і до якого терміну",
      "Who does what, and by when",
      "Wer macht was bis wann",
      "Quién hace qué y para cuándo",
    ),
  },
  {
    id: "finance",
    icon: "≡",
    name: tr("Деньги бизнеса", "Гроші бізнесу", "Business money", "Firmenfinanzen", "Finanzas del negocio"),
    hint: tr(
      "Доходы, расходы, налоги, отчёт бухгалтеру",
      "Доходи, витрати, податки, звіт бухгалтеру",
      "Income, costs, taxes, reports for the accountant",
      "Einnahmen, Ausgaben, Steuern, Unterlagen für den Steuerberater",
      "Ingresos, gastos, impuestos, informes para el contable",
    ),
  },
  {
    id: "other",
    icon: "＋",
    name: tr("Что-то своё", "Щось своє", "Something else", "Etwas anderes", "Otra cosa"),
    hint: tr(
      "Покажем всё, или опишите словами",
      "Покажемо все, або опишіть словами",
      "See everything, or describe it in words",
      "Alles ansehen oder in Worten beschreiben",
      "Ver todo o describirlo con palabras",
    ),
  },
];

/** A column of a template table; links and totals refer to other tables of the same template by key. */
export interface TemplateColumn extends ColumnDraft {
  linkTo?: string;
  /** "From link": show `column` of the row linked through `via`. */
  lookupOf?: { via: string; column: string };
  /** Total over the rows of table `table` that link here through its column `via`. */
  rollupOf?: { table: string; via: string; column: string | null; agg: RollupAgg; whereDone?: boolean; where?: { column: string; values: string[] } };
}

export interface TemplateTable {
  key: string;
  name: L10n;
  icon: string;
  columns: (l: Locale) => TemplateColumn[];
  ledger?: (l: Locale) => LedgerDraft;
}

export interface Template {
  id: string;
  icon: string;
  uses: UseCase[];
  name: L10n;
  description: L10n;
  /** What it does for the person. */
  why: L10n;
  /** The situation it fits. */
  when: L10n;
  /** Tables in creation order; links point to earlier ones. */
  tables: TemplateTable[];
  /** Key of the table to open after creating. */
  main: string;
  /** Ask for a savings target right away. */
  goal?: boolean;
  /** A first entry to suggest, as people would type it. */
  example?: L10n;
}

const one = (
  key: string,
  name: L10n,
  icon: string,
  columns: (l: Locale) => TemplateColumn[],
  ledger?: (l: Locale) => LedgerDraft,
): TemplateTable[] => [{ key, name, icon, columns, ledger }];

const bothLedger = (l: Locale): LedgerDraft => ({ amount: N.amount[l], kind: "both", type: N.type[l], incomeValues: [INCOME[l]] });

export const TEMPLATES: Template[] = [
  {
    id: "budget",
    example: tr("кофе 85", "кава 85", "coffee 3.50", "Kaffee 3,50", "café 2,50"),
    icon: "≡",
    uses: ["personal"],
    name: tr("Доходы и расходы", "Доходи та витрати", "Income & expenses", "Einnahmen & Ausgaben", "Ingresos y gastos"),
    description: tr(
      "Сколько пришло, сколько ушло и сколько осталось",
      "Скільки прийшло, скільки пішло і скільки лишилось",
      "What came in, what went out, and what's left",
      "Was reinkam, was rausging und was übrig bleibt",
      "Lo que entra, lo que sale y lo que queda",
    ),
    why: tr(
      "Сверху сразу видно: доход, траты и остаток за месяц. Напишите «кофе 85» — Sumira сама поставит категорию.",
      "Зверху одразу видно: дохід, витрати й залишок за місяць. Напишіть «кава 85» — Sumira сама поставить категорію.",
      "Income, spending and what's left this month, right on top. Type “coffee 4.50” and Sumira picks the category.",
      "Einnahmen, Ausgaben und Rest des Monats stehen oben. Tippen Sie „Kaffee 3,50“ — Sumira wählt die Kategorie.",
      "Arriba ves ingresos, gastos y lo que queda este mes. Escribe «café 2,50» y Sumira pone la categoría.",
    ),
    when: tr(
      "Хотите понимать, сколько приходит и куда уходит.",
      "Хочете розуміти, скільки надходить і куди йде.",
      "You want to see what comes in and where it goes.",
      "Sie wollen sehen, was reinkommt und wohin es geht.",
      "Quieres ver cuánto entra y adónde va.",
    ),
    main: "main",
    tables: one(
      "main",
      tr("Доходы и расходы", "Доходи та витрати", "Income & expenses", "Einnahmen & Ausgaben", "Ingresos y gastos"),
      "≡",
      (l) => [
        { name: N.date[l], type: "date" },
        typeColumn(l),
        categoryColumn(l, PERSONAL_INCOME, PERSONAL_EXPENSES),
        { name: N.amount[l], type: "money" },
        { name: N.note[l], type: "text" },
      ],
      bothLedger,
    ),
  },
  {
    id: "business",
    example: tr("материалы 450", "матеріали 450", "materials 120", "Material 45,90", "material 45,90"),
    icon: "≡",
    uses: ["finance", "services", "trade"],
    name: tr("Доходы и расходы бизнеса", "Доходи та витрати бізнесу", "Business income & costs", "Einnahmen & Ausgaben (EÜR)", "Ingresos y gastos del negocio"),
    description: tr(
      "Книга доходов и расходов с категориями для бухгалтера",
      "Книга доходів і витрат з категоріями для бухгалтера",
      "Income and costs with categories your accountant expects",
      "Einnahmen und Ausgaben mit Kategorien für den Steuerberater",
      "Ingresos y gastos con las categorías que pide el contable",
    ),
    why: tr(
      "Прибыль за месяц и квартал считается сама. Для бухгалтера — готовый файл с итогами по категориям.",
      "Прибуток за місяць і квартал рахується сам. Для бухгалтера — готовий файл з підсумками за категоріями.",
      "Profit per month and quarter works itself out. Your accountant gets a ready file with totals by category.",
      "Gewinn pro Monat und Quartal rechnet sich selbst. Der Steuerberater bekommt eine fertige Datei mit Summen pro Kategorie.",
      "El beneficio por mes y trimestre sale solo. Tu contable recibe un archivo listo con totales por categoría.",
    ),
    when: tr(
      "Вы ФОП, самозанятый или маленькая фирма и сдаёте отчёт.",
      "Ви ФОП, самозайнятий чи маленька фірма і здаєте звіт.",
      "You're self-employed or a small firm and file tax returns.",
      "Sie sind selbstständig oder eine kleine Firma und machen eine EÜR.",
      "Eres autónomo o una pequeña empresa y presentas impuestos.",
    ),
    main: "main",
    tables: one(
      "main",
      tr("Доходы и расходы бизнеса", "Доходи та витрати бізнесу", "Business income & costs", "Einnahmen & Ausgaben", "Ingresos y gastos"),
      "≡",
      (l) => [
        { name: N.date[l], type: "date" },
        typeColumn(l),
        categoryColumn(l, BUSINESS_INCOME, BUSINESS_EXPENSES),
        { name: N.amount[l], type: "money" },
        { name: N.counterparty[l], type: "text" },
        { name: N.note[l], type: "text" },
        { name: N.receipt[l], type: "photo" },
      ],
      bothLedger,
    ),
  },
  {
    id: "clients_payments",
    example: tr("Анна 12000 оплачено", "Олег 12000 оплачено", "Anna 900 paid", "Anna 900 bezahlt", "Ana 900 pagado"),
    icon: "◎",
    uses: ["services", "finance"],
    name: tr("Клиенты и оплаты", "Клієнти та оплати", "Clients & payments", "Kunden & Zahlungen", "Clientes y cobros"),
    description: tr(
      "Две связанные таблицы: клиенты и их оплаты",
      "Дві пов'язані таблиці: клієнти та їхні оплати",
      "Two linked tables: clients and what they paid",
      "Zwei verknüpfte Tabellen: Kunden und ihre Zahlungen",
      "Dos tablas enlazadas: clientes y lo que pagaron",
    ),
    why: tr(
      "У каждого клиента видна сумма всех оплат. Налог считается только с полученных денег.",
      "У кожного клієнта видно суму всіх оплат. Податок рахується тільки з отриманих грошей.",
      "Every client shows what they've paid in total. Tax counts only money actually received.",
      "Bei jedem Kunden steht die Summe seiner Zahlungen. Steuer zählt nur, was wirklich eingegangen ist.",
      "Cada cliente muestra el total cobrado. Los impuestos cuentan solo lo recibido.",
    ),
    when: tr(
      "Работаете с постоянными клиентами и выставляете счета.",
      "Працюєте з постійними клієнтами й виставляєте рахунки.",
      "You work with regular clients and send invoices.",
      "Sie haben Stammkunden und schreiben Rechnungen.",
      "Trabajas con clientes habituales y emites facturas.",
    ),
    main: "payments",
    tables: [
      {
        key: "clients",
        name: tr("Клиенты", "Клієнти", "Clients", "Kunden", "Clientes"),
        icon: "◉",
        columns: (l) => [
          { name: N.name[l], type: "text" },
          { name: N.city[l], type: "text" },
          { name: N.phone[l], type: "text" },
          { name: N.received_total[l], type: "rollup", rollupOf: { table: "payments", via: N.client[l], column: N.amount[l], agg: "sum", where: { column: N.paid[l], values: ["true"] } } },
          { name: N.debt[l], type: "rollup", rollupOf: { table: "payments", via: N.client[l], column: N.amount[l], agg: "sum", where: { column: N.paid[l], values: [""] } } },
          { name: N.note[l], type: "text" },
        ],
      },
      {
        key: "payments",
        name: tr("Оплаты", "Оплати", "Payments", "Zahlungen", "Cobros"),
        icon: "◎",
        columns: (l) => [
          { name: N.date[l], type: "date" },
          { name: N.client[l], type: "link", linkTo: "clients" },
          { name: N.service[l], type: "text" },
          { name: N.amount[l], type: "money" },
          { name: N.paid[l], type: "checkbox" },
          { name: N.paidOn[l], type: "date" },
          { name: N.note[l], type: "text" },
        ],
        // Income counts on the day it arrives: a September invoice paid in October is October income.
        ledger: (l) => ({ amount: N.amount[l], kind: "income", paid: N.paid[l], date: N.paidOn[l] }),
      },
    ],
  },
  {
    id: "orders",
    example: tr("Анна торт 1500", "Анна торт 1500", "Anna cake 45", "Anna Torte 45", "Ana tarta 45"),
    icon: "◎",
    uses: ["services", "trade"],
    name: tr("Заказы", "Замовлення", "Orders", "Aufträge", "Pedidos"),
    description: tr(
      "Кто заказал, сколько и оплатил ли",
      "Хто замовив, скільки та чи оплатив",
      "Who ordered, how much, and if they paid",
      "Wer bestellt hat, wie viel und ob bezahlt",
      "Quién pidió, cuánto y si pagó",
    ),
    why: tr(
      "Статус и оплата в одно касание. Сразу видно, что в работе и кто ещё не заплатил.",
      "Статус і оплата в один дотик. Одразу видно, що в роботі і хто ще не заплатив.",
      "Status and payment in one tap. You see at once what's in progress and who hasn't paid.",
      "Status und Zahlung mit einem Tipp. Sofort sichtbar, was läuft und wer noch nicht bezahlt hat.",
      "Estado y pago con un toque. Ves al momento qué está en curso y quién no ha pagado.",
    ),
    when: tr(
      "Берёте заказы и хотите видеть, что в работе и что не оплачено.",
      "Берете замовлення й хочете бачити, що в роботі і що не оплачено.",
      "You take orders and want to see what's in progress and what's unpaid.",
      "Sie nehmen Aufträge an und wollen sehen, was läuft und was offen ist.",
      "Recibes pedidos y quieres ver qué está en curso y qué falta cobrar.",
    ),
    main: "main",
    tables: one(
      "main",
      tr("Заказы", "Замовлення", "Orders", "Aufträge", "Pedidos"),
      "◎",
      (l) => [
        { name: N.date[l], type: "date" },
        { name: N.client[l], type: "text" },
        { name: N.item[l], type: "text" },
        { name: N.amount[l], type: "money" },
        {
          name: N.status[l],
          type: "select",
          options: opts(
            tr("Новый", "Новий", "New", "Neu", "Nuevo"),
            tr("В работе", "В роботі", "In progress", "In Arbeit", "En curso"),
            tr("Готов", "Готовий", "Done", "Fertig", "Listo"),
          )(l),
        },
        { name: N.paid[l], type: "checkbox" },
      ],
      (l) => ({ amount: N.amount[l], kind: "income", paid: N.paid[l] }),
    ),
  },
  {
    id: "stock_sales",
    example: tr("чехол 2", "чохол 2", "case 2", "Hülle 2", "funda 2"),
    icon: "▤",
    uses: ["trade"],
    name: tr("Склад и продажи", "Склад і продажі", "Stock & sales", "Lager & Verkäufe", "Stock y ventas"),
    description: tr(
      "Товары и продажи: остаток и маржа считаются сами",
      "Товари й продажі: залишок і маржа рахуються самі",
      "Products and sales: stock and margin work themselves out",
      "Artikel und Verkäufe: Bestand und Marge rechnen sich selbst",
      "Productos y ventas: stock y margen se calculan solos",
    ),
    why: tr(
      "Продали — остаток уменьшился сам. Цена и закупка подтягиваются из товара, маржа видна по каждой продаже.",
      "Продали — залишок зменшився сам. Ціна й закупівля підтягуються з товару, маржа видна з кожного продажу.",
      "Sell something and the stock goes down by itself. Price and cost come from the product; margin shows on every sale.",
      "Verkauft — der Bestand sinkt von selbst. Preis und Einkauf kommen vom Artikel, die Marge steht bei jedem Verkauf.",
      "Vendes y el stock baja solo. Precio y coste vienen del producto; el margen se ve en cada venta.",
    ),
    when: tr(
      "Продаёте товары (маркетплейсы, Instagram, магазин) и ведёте склад.",
      "Продаєте товари (маркетплейси, Instagram, магазин) і ведете склад.",
      "You sell products (marketplaces, Instagram, a shop) and keep stock.",
      "Sie verkaufen Waren (Marktplätze, Instagram, Laden) und führen ein Lager.",
      "Vendes productos (marketplaces, Instagram, tienda) y llevas stock.",
    ),
    main: "sales",
    tables: [
      {
        key: "products",
        name: tr("Товары", "Товари", "Products", "Artikel", "Productos"),
        icon: "▤",
        columns: (l) => [
          { name: N.item[l], type: "text" },
          { name: N.sku[l], type: "text" },
          { name: N.category[l], type: "select", options: [] },
          { name: N.cost[l], type: "money" },
          { name: N.price[l], type: "money" },
          { name: N.received[l], type: "number" },
          { name: N.sold[l], type: "rollup", rollupOf: { table: "sales", via: N.item[l], column: N.qty[l], agg: "sum" } },
          { name: N.stock[l], type: "formula", formula: `[${N.received[l]}] - [${N.sold[l]}]`, format: "number" },
          { name: N.supplier[l], type: "text" },
        ],
      },
      {
        key: "sales",
        name: tr("Продажи", "Продажі", "Sales", "Verkäufe", "Ventas"),
        icon: "◎",
        columns: (l) => [
          { name: N.date[l], type: "date" },
          { name: N.item[l], type: "link", linkTo: "products" },
          { name: N.qty[l], type: "number", default: 1 },
          { name: N.price[l], type: "lookup", lookupOf: { via: N.item[l], column: N.price[l] } },
          // A discount or marketplace price: the sum is quantity × price minus the discount.
          { name: N.discount[l], type: "money" },
          { name: N.amount[l], type: "formula", formula: `[${N.qty[l]}] * [${N.price[l]}] - [${N.discount[l]}]`, format: "money" },
          { name: N.cost[l], type: "lookup", lookupOf: { via: N.item[l], column: N.cost[l] } },
          { name: N.margin[l], type: "formula", formula: `[${N.amount[l]}] - [${N.qty[l]}] * [${N.cost[l]}]` },
          { name: N.channel[l], type: "select", options: ["Instagram", tr("Маркетплейс", "Маркетплейс", "Marketplace", "Marktplatz", "Marketplace")[l], tr("Магазин", "Магазин", "Shop", "Laden", "Tienda")[l], tr("Сайт", "Сайт", "Website", "Webshop", "Web")[l]] },
          { name: N.paid[l], type: "checkbox", default: true },
        ],
        ledger: (l) => ({ amount: N.amount[l], kind: "income", paid: N.paid[l] }),
      },
    ],
  },
  {
    id: "inventory",
    icon: "▤",
    uses: ["trade"],
    name: tr("Склад", "Склад", "Inventory", "Lager", "Inventario"),
    description: tr(
      "Товары, остатки и стоимость",
      "Товари, залишки та вартість",
      "Items, stock and value",
      "Artikel, Bestand und Wert",
      "Artículos, stock y valor",
    ),
    why: tr(
      "Итог по каждой строке и по всему складу считается сам.",
      "Підсумок по кожному рядку й по всьому складу рахується сам.",
      "The total for each item and for the whole stock works itself out.",
      "Die Summe pro Artikel und fürs ganze Lager rechnet sich selbst.",
      "El total de cada artículo y de todo el stock se calcula solo.",
    ),
    when: tr(
      "Нужно знать, что лежит на складе и на какую сумму.",
      "Треба знати, що лежить на складі й на яку суму.",
      "You need to know what's in stock and what it's worth.",
      "Sie müssen wissen, was auf Lager ist und was es wert ist.",
      "Necesitas saber qué hay en stock y cuánto vale.",
    ),
    main: "main",
    tables: one("main", tr("Склад", "Склад", "Inventory", "Lager", "Inventario"), "▤", (l) => [
      { name: N.item[l], type: "text" },
      { name: N.qty[l], type: "number" },
      { name: N.price[l], type: "money" },
      { name: N.total[l], type: "formula", formula: `[${N.qty[l]}] * [${N.price[l]}]` },
    ]),
  },
  {
    id: "team_jobs",
    example: tr("уборка офиса 120 завтра", "прибирання офісу 120 завтра", "office clean 120 tomorrow", "Büroreinigung 120 morgen", "limpieza oficina 120 mañana"),
    icon: "▦",
    uses: ["team", "services"],
    name: tr("Работы и команда", "Роботи та команда", "Jobs & team", "Aufträge & Team", "Trabajos y equipo"),
    description: tr(
      "Клиенты, сотрудники и работы — связаны между собой",
      "Клієнти, працівники й роботи — пов'язані між собою",
      "Clients, staff and jobs — linked together",
      "Kunden, Mitarbeiter und Aufträge — miteinander verknüpft",
      "Clientes, personal y trabajos, enlazados",
    ),
    why: tr(
      "У клиента видна выручка, у сотрудника — часы. Неделя, статусы и проблемы — на одной доске.",
      "У клієнта видно виручку, у працівника — години. Тиждень, статуси й проблеми — на одній дошці.",
      "Each client shows revenue, each person their hours. The week, statuses and problems on one board.",
      "Jeder Kunde zeigt den Umsatz, jeder Mitarbeiter seine Stunden. Woche, Status und Probleme auf einem Board.",
      "Cada cliente muestra sus ingresos y cada persona sus horas. Semana, estados y problemas en un tablero.",
    ),
    when: tr(
      "У вас бригада или небольшая команда, которая ездит к клиентам.",
      "У вас бригада чи невелика команда, що їздить до клієнтів.",
      "You run a crew or small team that works at clients' places.",
      "Sie haben ein kleines Team, das bei Kunden arbeitet.",
      "Tienes un equipo pequeño que trabaja en casa de los clientes.",
    ),
    main: "jobs",
    tables: [
      {
        key: "clients",
        name: tr("Клиенты", "Клієнти", "Clients", "Kunden", "Clientes"),
        icon: "◉",
        columns: (l) => [
          { name: N.title[l], type: "text" },
          { name: N.address[l], type: "text" },
          { name: N.contact[l], type: "text" },
          { name: N.fee[l], type: "money" },
          { name: N.revenue[l], type: "rollup", rollupOf: { table: "jobs", via: N.client[l], column: N.price[l], agg: "sum", whereDone: true } },
        ],
      },
      {
        key: "staff",
        name: tr("Сотрудники", "Працівники", "Staff", "Mitarbeiter", "Personal"),
        icon: "◐",
        columns: (l) => [
          { name: N.name[l], type: "text" },
          { name: N.phone[l], type: "text" },
          { name: N.rate[l], type: "money" },
          { name: N.hours[l], type: "rollup", rollupOf: { table: "jobs", via: N.worker[l], column: N.hours[l], agg: "sum", whereDone: true } },
          { name: N.active[l], type: "checkbox", default: true },
        ],
      },
      {
        key: "jobs",
        name: tr("Работы", "Роботи", "Jobs", "Aufträge", "Trabajos"),
        icon: "▦",
        columns: (l) => [
          { name: N.job[l], type: "text" },
          { name: N.client[l], type: "link", linkTo: "clients" },
          { name: N.worker[l], type: "link", linkTo: "staff" },
          { name: N.date[l], type: "date" },
          {
            name: N.status[l],
            type: "select",
            options: opts(
              tr("Запланировано", "Заплановано", "Planned", "Geplant", "Planificado"),
              tr("В работе", "В роботі", "In progress", "In Arbeit", "En curso"),
              DONE,
              tr("Проблема", "Проблема", "Problem", "Problem", "Problema"),
            )(l),
            default: tr("Запланировано", "Заплановано", "Planned", "Geplant", "Planificado")[l],
          },
          { name: N.hours[l], type: "number" },
          { name: N.price[l], type: "money" },
        ],
        // A job is income once it's done; planned and problem jobs are not money yet.
        ledger: (l) => ({ amount: N.price[l], kind: "income", onlyWhen: { column: N.status[l], values: [DONE[l]] } }),
      },
    ],
  },
  {
    id: "clients",
    icon: "◉",
    uses: ["services", "trade", "team"],
    name: tr("База клиентов", "База клієнтів", "Client list", "Kundenliste", "Lista de clientes"),
    description: tr(
      "Контакты и с кем давно не говорили",
      "Контакти і з ким давно не говорили",
      "Contacts and who you haven't called in a while",
      "Kontakte und wen Sie lange nicht gesprochen haben",
      "Contactos y con quién hace tiempo que no hablas",
    ),
    why: tr(
      "Видно, с кем давно не говорили и кому пора позвонить.",
      "Видно, з ким давно не говорили і кому час подзвонити.",
      "See who you haven't talked to in a while and who to call next.",
      "Sie sehen, mit wem Sie lange nicht gesprochen haben und wen Sie anrufen sollten.",
      "Ves con quién hace tiempo que no hablas y a quién llamar.",
    ),
    when: tr(
      "Клиентов больше, чем помещается в голове.",
      "Клієнтів більше, ніж вміщається в голові.",
      "You have more clients than you can keep in your head.",
      "Sie haben mehr Kunden, als Sie im Kopf behalten können.",
      "Tienes más clientes de los que caben en la cabeza.",
    ),
    main: "main",
    tables: one("main", tr("База клиентов", "База клієнтів", "Client list", "Kundenliste", "Lista de clientes"), "◉", (l) => [
      { name: N.name[l], type: "text" },
      { name: N.company[l], type: "text" },
      { name: N.phone[l], type: "text" },
      {
        name: N.status[l],
        type: "select",
        options: opts(
          tr("Новый", "Новий", "New", "Neu", "Nuevo"),
          tr("Постоянный", "Постійний", "Regular", "Stammkunde", "Habitual"),
          tr("Ушёл", "Пішов", "Lost", "Verloren", "Perdido"),
        )(l),
      },
      { name: N.lastContact[l], type: "date" },
      { name: N.note[l], type: "text" },
    ]),
  },
  {
    id: "tasks",
    icon: "▦",
    uses: ["team", "services"],
    name: tr("Задачи команды", "Завдання команди", "Team tasks", "Team-Aufgaben", "Tareas del equipo"),
    description: tr(
      "Кто, что и к какому сроку",
      "Хто, що й до якого терміну",
      "Who does what, by when",
      "Wer macht was bis wann",
      "Quién hace qué y para cuándo",
    ),
    why: tr(
      "Доска по статусам и календарь сроков. Сразу видно, что горит.",
      "Дошка за статусами й календар термінів. Одразу видно, що горить.",
      "A board by status and a calendar of due dates. You see what's urgent at a glance.",
      "Ein Board nach Status und ein Terminkalender. Man sieht sofort, was brennt.",
      "Un tablero por estado y un calendario de fechas. Ves de un vistazo lo urgente.",
    ),
    when: tr(
      "Работаете не один и важно, кто за что отвечает.",
      "Працюєте не самі й важливо, хто за що відповідає.",
      "You work with others and need to know who owns what.",
      "Sie arbeiten im Team und müssen wissen, wer wofür zuständig ist.",
      "Trabajas en equipo y necesitas saber quién se encarga de qué.",
    ),
    main: "main",
    tables: one("main", tr("Задачи команды", "Завдання команди", "Team tasks", "Team-Aufgaben", "Tareas del equipo"), "▦", (l) => [
      { name: N.task[l], type: "text" },
      { name: N.owner[l], type: "text" },
      { name: N.due[l], type: "date" },
      {
        name: N.status[l],
        type: "select",
        options: opts(
          tr("Надо сделать", "Треба зробити", "To do", "Offen", "Pendiente"),
          tr("В работе", "В роботі", "In progress", "In Arbeit", "En curso"),
          tr("На проверке", "На перевірці", "Review", "Prüfung", "En revisión"),
          tr("Готово", "Готово", "Done", "Erledigt", "Hecho"),
        )(l),
        default: tr("Надо сделать", "Треба зробити", "To do", "Offen", "Pendiente")[l],
      },
    ]),
  },
  {
    id: "expenses",
    example: tr("такси 450", "таксі 240", "taxi 12", "Taxi 12", "taxi 12"),
    icon: "↘",
    uses: ["personal"],
    name: tr("Расходы", "Витрати", "Expenses", "Ausgaben", "Gastos"),
    description: tr(
      "Куда уходят деньги, по категориям",
      "Куди йдуть гроші, за категоріями",
      "Where the money goes, by category",
      "Wohin das Geld geht, nach Kategorie",
      "En qué se va el dinero, por categoría",
    ),
    why: tr(
      "Напишите «такси 450» — запись готова, категория подставится сама.",
      "Напишіть «таксі 450» — запис готовий, категорія підставиться сама.",
      "Type “taxi 12” and the entry is done, category included.",
      "Tippen Sie „Taxi 12“ — fertig, die Kategorie wird erkannt.",
      "Escribe «taxi 12» y listo, con la categoría puesta.",
    ),
    when: tr(
      "Деньги куда-то утекают и хочется понять куда.",
      "Гроші кудись витікають і хочеться зрозуміти куди.",
      "Money keeps disappearing and you want to know where.",
      "Das Geld verschwindet und Sie wollen wissen, wohin.",
      "El dinero se esfuma y quieres saber en qué.",
    ),
    main: "main",
    tables: one(
      "main",
      tr("Расходы", "Витрати", "Expenses", "Ausgaben", "Gastos"),
      "↘",
      (l) => [
        { name: N.date[l], type: "date" },
        { name: N.category[l], type: "select", options: PERSONAL_EXPENSES.map((c) => c.name[l]) },
        { name: N.amount[l], type: "money" },
        { name: N.note[l], type: "text" },
      ],
      (l) => ({ amount: N.amount[l], kind: "expense" }),
    ),
  },
  {
    id: "savings",
    example: tr("5000", "5000", "200", "200", "200"),
    icon: "◔",
    uses: ["personal"],
    name: tr("Копилка с целью", "Скарбничка з ціллю", "Savings goal", "Sparziel", "Hucha con objetivo"),
    description: tr(
      "Сколько отложили и сколько осталось до цели",
      "Скільки відклали і скільки лишилось до цілі",
      "What you've put aside and how far to go",
      "Was Sie zurückgelegt haben und was noch fehlt",
      "Cuánto has apartado y cuánto te falta",
    ),
    why: tr(
      "Цель и полоска прогресса сверху. Sumira скажет, сколько откладывать в месяц, чтобы успеть.",
      "Ціль і смужка прогресу зверху. Sumira скаже, скільки відкладати щомісяця, щоб встигнути.",
      "Your goal and a progress bar on top. Sumira tells you how much to save each month to make it.",
      "Ziel und Fortschrittsbalken oben. Sumira sagt, wie viel Sie monatlich sparen müssen.",
      "Tu objetivo y una barra de progreso arriba. Sumira te dice cuánto ahorrar al mes para llegar.",
    ),
    when: tr(
      "Копите на отпуск, машину или подушку безопасности.",
      "Накопичуєте на відпустку, авто чи подушку безпеки.",
      "You're saving for a holiday, a car or a safety cushion.",
      "Sie sparen auf Urlaub, ein Auto oder einen Notgroschen.",
      "Ahorras para unas vacaciones, un coche o un colchón.",
    ),
    main: "main",
    goal: true,
    tables: one("main", tr("Копилка", "Скарбничка", "Savings", "Sparziel", "Hucha"), "◔", (l) => [
      { name: N.date[l], type: "date" },
      { name: N.amount[l], type: "money" },
      { name: N.note[l], type: "text" },
    ]),
  },
  {
    id: "debts",
    example: tr("Олег 500", "Олег 500", "Tom 50", "Tom 50", "Tom 50"),
    icon: "⇄",
    uses: ["personal", "finance"],
    name: tr("Долги", "Борги", "Debts", "Schulden", "Deudas"),
    description: tr(
      "Кто кому должен и до какого числа",
      "Хто кому винен і до якого числа",
      "Who owes whom, and by when",
      "Wer wem was schuldet, bis wann",
      "Quién debe a quién y hasta cuándo",
    ),
    why: tr(
      "Итог показывает, сколько вам должны прямо сейчас. Вернули — галочка.",
      "Підсумок показує, скільки вам винні просто зараз. Повернули — галочка.",
      "The total shows what you're owed right now. Paid back — tick it off.",
      "Die Summe zeigt, was man Ihnen gerade schuldet. Zurückgezahlt — abhaken.",
      "El total muestra lo que te deben ahora mismo. Devuelto: marca la casilla.",
    ),
    when: tr(
      "Даёте или берёте в долг и не хотите забыть.",
      "Даєте або берете в борг і не хочете забути.",
      "You lend or borrow and don't want to forget.",
      "Sie verleihen oder leihen und wollen es nicht vergessen.",
      "Prestas o pides prestado y no quieres olvidarlo.",
    ),
    main: "main",
    tables: one("main", tr("Долги", "Борги", "Debts", "Schulden", "Deudas"), "⇄", (l) => [
      { name: N.who[l], type: "text" },
      {
        name: N.direction[l],
        type: "select",
        options: opts(
          tr("Мне должны", "Мені винні", "Owed to me", "Man schuldet mir", "Me deben"),
          tr("Я должен", "Я винен", "I owe", "Ich schulde", "Debo yo"),
        )(l),
      },
      { name: N.amount[l], type: "money" },
      { name: N.due[l], type: "date" },
      { name: N.returned[l], type: "checkbox" },
    ]),
  },
  {
    id: "trips",
    example: tr("Киев — Бровары 32 км", "Київ — Бровари 32 км", "London — Oxford 95 km", "Köln — Bonn 30 km", "Madrid — Toledo 70 km"),
    icon: "↗",
    uses: ["finance", "services"],
    name: tr("Поездки на авто", "Поїздки авто", "Mileage log", "Fahrtenbuch", "Kilometraje"),
    description: tr(
      "Деловые поездки: километры и сумма к возмещению",
      "Ділові поїздки: кілометри й сума до відшкодування",
      "Business trips: kilometres and the amount you can claim",
      "Dienstfahrten: Kilometer und absetzbarer Betrag",
      "Viajes de trabajo: kilómetros e importe a deducir",
    ),
    why: tr(
      "Сумма считается сама по ставке 0,30 за км — ставку можно поменять в колонке.",
      "Сума рахується сама за ставкою 0,30 за км — ставку можна змінити в колонці.",
      "The amount works itself out at 0.30 per km — change the rate in the column any time.",
      "Der Betrag rechnet sich mit 0,30 € pro km — den Satz können Sie in der Spalte ändern.",
      "El importe se calcula a 0,30 por km; puedes cambiar la tarifa en la columna.",
    ),
    when: tr(
      "Ездите к клиентам на своей машине и хотите списать расходы.",
      "Їздите до клієнтів власним авто й хочете списати витрати.",
      "You drive your own car to clients and want to claim it.",
      "Sie fahren mit dem eigenen Auto zu Kunden und wollen es absetzen.",
      "Vas a ver clientes en tu coche y quieres deducirlo.",
    ),
    main: "main",
    tables: one("main", tr("Поездки", "Поїздки", "Trips", "Fahrtenbuch", "Viajes"), "↗", (l) => [
      { name: N.date[l], type: "date" },
      { name: N.route[l], type: "text" },
      { name: N.purpose[l], type: "text" },
      { name: N.km[l], type: "number" },
      { name: N.allowance[l], type: "formula", formula: `[${N.km[l]}] * 0,30`, format: "money" },
    ]),
  },
];

export function templatesFor(use: UseCase): Template[] {
  if (use === "other") return TEMPLATES;
  return TEMPLATES.filter((t) => t.uses.includes(use));
}

export function findTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Columns of the table a template opens with — what the onboarding shows. */
export function templateColumns(tpl: Template, l: Locale): TemplateColumn[] {
  return (tpl.tables.find((t) => t.key === tpl.main) ?? tpl.tables[0]).columns(l);
}

/**
 * Create all tables of a template, wired together: links point at the right
 * table, "from link" columns and totals over linked rows are resolved.
 */
export function instantiateTemplate(tpl: Template, l: Locale, ctx: CommandContext): { op: Op; tables: Table[]; mainId: string } {
  const built = new Map<string, Table>();
  const drafts = new Map<string, TemplateColumn[]>();
  for (const spec of tpl.tables) {
    const columns = spec.columns(l);
    drafts.set(spec.key, columns);
    const res = createTable(
      { name: spec.name[l], icon: spec.icon, columns, template: tpl.id, ledger: spec.ledger?.(l) },
      { ...ctx, ws: undefined },
    );
    built.set(spec.key, res.table);
  }
  for (const spec of tpl.tables) {
    const table = built.get(spec.key)!;
    drafts.get(spec.key)!.forEach((d, i) => {
      const col = table.columns[i];
      if (d.linkTo) col.linkTableId = built.get(d.linkTo)?.id;
      if (d.lookupOf) {
        const via = findColumnByName(table.columns, d.lookupOf.via);
        const linkTo = drafts.get(spec.key)!.find((c) => c.name === d.lookupOf!.via)?.linkTo;
        const target = linkTo ? built.get(linkTo) : undefined;
        const targetCol = target && findColumnByName(target.columns, d.lookupOf.column);
        if (via && targetCol) col.lookup = { viaColumnId: via.id, columnId: targetCol.id };
      }
      if (d.rollupOf) {
        const source = built.get(d.rollupOf.table);
        const via = source && findColumnByName(source.columns, d.rollupOf.via);
        const valueCol = source && d.rollupOf.column ? findColumnByName(source.columns, d.rollupOf.column) : undefined;
        if (source && via) col.rollup = { tableId: source.id, linkColumnId: via.id, columnId: valueCol?.id ?? null, agg: d.rollupOf.agg };
        const status = source && d.rollupOf.whereDone ? findColumnByName(source.columns, N.status[l]) : undefined;
        if (col.rollup && status) col.rollup.where = { columnId: status.id, values: [DONE[l]] };
        const whereCol = source && d.rollupOf.where ? findColumnByName(source.columns, d.rollupOf.where.column) : undefined;
        if (col.rollup && whereCol) col.rollup.where = { columnId: whereCol.id, values: d.rollupOf.where!.values };
      }
    });
  }
  const tables = tpl.tables.map((s) => built.get(s.key)!);
  const ops: Op[] = tables.map((table) => ({ type: "table.create", table }));
  return { op: ops.length === 1 ? ops[0] : { type: "batch", ops }, tables, mainId: built.get(tpl.main)!.id };
}
