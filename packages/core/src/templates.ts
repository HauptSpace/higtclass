import type { ColumnDraft } from "./commands.ts";
import type { Locale } from "./types.ts";

// Ready-made starting points, so nobody faces an empty sheet.
// Every name is translated; formulas are built from the translated names.
// Each template also says why it beats a plain spreadsheet and when to pick it,
// which is what the onboarding shows.

export type L10n = Record<Locale, string>;

const tr = (ru: string, uk: string, en: string, de: string, es: string): L10n => ({ ru, uk, en, de, es });

const N = {
  date: tr("Дата", "Дата", "Date", "Datum", "Fecha"),
  amount: tr("Сумма", "Сума", "Amount", "Betrag", "Importe"),
  note: tr("Комментарий", "Коментар", "Note", "Notiz", "Nota"),
  category: tr("Категория", "Категорія", "Category", "Kategorie", "Categoría"),
  type: tr("Тип", "Тип", "Type", "Art", "Tipo"),
  item: tr("Товар", "Товар", "Item", "Artikel", "Artículo"),
  qty: tr("Количество", "Кількість", "Quantity", "Menge", "Cantidad"),
  price: tr("Цена", "Ціна", "Price", "Preis", "Precio"),
  total: tr("Итого", "Разом", "Total", "Summe", "Total"),
  client: tr("Клиент", "Клієнт", "Client", "Kunde", "Cliente"),
  name: tr("Имя", "Ім'я", "Name", "Name", "Nombre"),
  company: tr("Компания", "Компанія", "Company", "Firma", "Empresa"),
  phone: tr("Телефон", "Телефон", "Phone", "Telefon", "Teléfono"),
  status: tr("Статус", "Статус", "Status", "Status", "Estado"),
  paid: tr("Оплачено", "Оплачено", "Paid", "Bezahlt", "Pagado"),
  task: tr("Задача", "Завдання", "Task", "Aufgabe", "Tarea"),
  owner: tr("Ответственный", "Відповідальний", "Owner", "Zuständig", "Responsable"),
  due: tr("Срок", "Термін", "Due", "Fällig", "Fecha límite"),
  done: tr("Готово", "Готово", "Done", "Erledigt", "Hecho"),
  who: tr("Кто", "Хто", "Who", "Wer", "Quién"),
  direction: tr("Кто должен", "Хто винен", "Who owes", "Wer schuldet", "Quién debe"),
  returned: tr("Вернули", "Повернули", "Settled", "Beglichen", "Devuelto"),
  lastContact: tr("Последний контакт", "Останній контакт", "Last contact", "Letzter Kontakt", "Último contacto"),
};

const opts = (...items: L10n[]) => (l: Locale) => items.map((i) => i[l]);

const expenseCategories = opts(
  tr("Еда", "Їжа", "Food", "Essen", "Comida"),
  tr("Транспорт", "Транспорт", "Transport", "Transport", "Transporte"),
  tr("Дом", "Дім", "Home", "Wohnen", "Casa"),
  tr("Связь", "Зв'язок", "Phone & internet", "Telefon & Internet", "Teléfono e internet"),
  tr("Здоровье", "Здоров'я", "Health", "Gesundheit", "Salud"),
  tr("Развлечения", "Розваги", "Fun", "Freizeit", "Ocio"),
  tr("Другое", "Інше", "Other", "Sonstiges", "Otros"),
);

/** What the person told the onboarding they want Zifra for. */
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
    name: tr("Финансы компании", "Фінанси компанії", "Company finances", "Firmenfinanzen", "Finanzas de la empresa"),
    hint: tr(
      "Доходы, расходы, должники, отчёт бухгалтеру",
      "Доходи, витрати, боржники, звіт бухгалтеру",
      "Income, costs, who owes you, reports for the accountant",
      "Einnahmen, Kosten, offene Posten, Berichte für die Buchhaltung",
      "Ingresos, gastos, deudores, informes para el contable",
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

export interface Template {
  id: string;
  icon: string;
  uses: UseCase[];
  name: L10n;
  description: L10n;
  /** Why this beats doing the same thing in a plain spreadsheet. */
  why: L10n;
  /** The situation it fits. */
  when: L10n;
  columns: (l: Locale) => ColumnDraft[];
}

export const TEMPLATES: Template[] = [
  {
    id: "orders",
    icon: "◎",
    uses: ["services", "trade", "finance"],
    name: tr("Клиенты и заказы", "Клієнти та замовлення", "Clients & orders", "Kunden & Aufträge", "Clientes y pedidos"),
    description: tr(
      "Кто заказал, сколько и оплатил ли",
      "Хто замовив, скільки та чи оплатив",
      "Who ordered, how much, and if they paid",
      "Wer bestellt hat, wie viel und ob bezahlt",
      "Quién pidió, cuánto y si pagó",
    ),
    why: tr(
      "Статус и оплата — кнопки, а не цвет ячейки. Сразу видно, кто не заплатил.",
      "Статус і оплата — кнопки, а не колір клітинки. Одразу видно, хто не заплатив.",
      "Status and payment are one tap, not a cell colour. Unpaid orders stand out at once.",
      "Status und Zahlung sind ein Tipp statt Zellfarbe. Offene Zahlungen fallen sofort auf.",
      "Estado y pago con un toque, no con colores de celda. Lo pendiente salta a la vista.",
    ),
    when: tr(
      "У вас есть клиенты и вы берёте деньги за работу или товар.",
      "У вас є клієнти, і ви берете гроші за роботу чи товар.",
      "You have clients and get paid for work or goods.",
      "Sie haben Kunden und werden für Arbeit oder Ware bezahlt.",
      "Tienes clientes y cobras por trabajo o productos.",
    ),
    columns: (l) => [
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
      "«Итого» считается само для каждой строки — нечего протягивать и негде ошибиться.",
      "«Разом» рахується саме для кожного рядка — нічого протягувати й ніде помилитися.",
      "Totals calculate themselves for every row — nothing to drag down, nothing to break.",
      "Summen rechnen sich für jede Zeile selbst — nichts ziehen, nichts kaputt machen.",
      "El total se calcula solo en cada fila: nada que arrastrar ni que romper.",
    ),
    when: tr(
      "Нужно знать, что лежит на складе и на какую сумму.",
      "Треба знати, що лежить на складі й на яку суму.",
      "You need to know what's in stock and what it's worth.",
      "Sie müssen wissen, was auf Lager ist und was es wert ist.",
      "Necesitas saber qué hay en stock y cuánto vale.",
    ),
    columns: (l) => [
      { name: N.item[l], type: "text" },
      { name: N.qty[l], type: "number" },
      { name: N.price[l], type: "money" },
      { name: N.total[l], type: "formula", formula: `[${N.qty[l]}] * [${N.price[l]}]` },
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
      "Сортировка по последнему контакту показывает, кому пора позвонить. Без CRM за деньги.",
      "Сортування за останнім контактом показує, кому час подзвонити. Без платної CRM.",
      "Sort by last contact to see who to call next — no paid CRM needed.",
      "Nach letztem Kontakt sortieren und sehen, wen Sie anrufen sollten — ohne teures CRM.",
      "Ordena por último contacto y verás a quién llamar, sin pagar un CRM.",
    ),
    when: tr(
      "Клиентов больше, чем помещается в голове.",
      "Клієнтів більше, ніж вміщається в голові.",
      "You have more clients than you can keep in your head.",
      "Sie haben mehr Kunden, als Sie im Kopf behalten können.",
      "Tienes más clientes de los que caben en la cabeza.",
    ),
    columns: (l) => [
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
    ],
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
      "Галочка «Готово» и срок вместо зачёркнутого текста. Видно, что горит.",
      "Галочка «Готово» і термін замість закресленого тексту. Видно, що горить.",
      "A Done checkbox and a due date instead of strikethrough text. You see what's late.",
      "Ein Erledigt-Häkchen und ein Termin statt durchgestrichenem Text. Man sieht, was brennt.",
      "Casilla de hecho y fecha límite en vez de texto tachado. Ves lo que urge.",
    ),
    when: tr(
      "Работаете не один и важно, кто за что отвечает.",
      "Працюєте не самі й важливо, хто за що відповідає.",
      "You work with others and need to know who owns what.",
      "Sie arbeiten im Team und müssen wissen, wer wofür zuständig ist.",
      "Trabajas en equipo y necesitas saber quién se encarga de qué.",
    ),
    columns: (l) => [
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
        )(l),
      },
      { name: N.done[l], type: "checkbox" },
    ],
  },
  {
    id: "budget",
    icon: "≡",
    uses: ["finance", "personal"],
    name: tr("Доходы и расходы", "Доходи та витрати", "Income & expenses", "Einnahmen & Ausgaben", "Ingresos y gastos"),
    description: tr(
      "Всё движение денег в одном месте",
      "Увесь рух грошей в одному місці",
      "All your cash flow in one place",
      "Alle Geldflüsse an einem Ort",
      "Todo tu dinero en un solo lugar",
    ),
    why: tr(
      "Итоги по месяцам и категориям строятся сами — без сводных таблиц.",
      "Підсумки за місяцями й категоріями будуються самі — без зведених таблиць.",
      "Totals by month and category build themselves — no pivot tables.",
      "Summen nach Monat und Kategorie entstehen von selbst — keine Pivot-Tabellen.",
      "Los totales por mes y categoría salen solos, sin tablas dinámicas.",
    ),
    when: tr(
      "Хотите понимать, сколько приходит и куда уходит.",
      "Хочете розуміти, скільки надходить і куди йде.",
      "You want to see what comes in and where it goes.",
      "Sie wollen sehen, was reinkommt und wohin es geht.",
      "Quieres ver cuánto entra y adónde va.",
    ),
    columns: (l) => [
      { name: N.date[l], type: "date" },
      {
        name: N.type[l],
        type: "select",
        options: opts(
          tr("Доход", "Дохід", "Income", "Einnahme", "Ingreso"),
          tr("Расход", "Витрата", "Expense", "Ausgabe", "Gasto"),
        )(l),
      },
      { name: N.category[l], type: "select", options: expenseCategories(l) },
      { name: N.amount[l], type: "money" },
      { name: N.note[l], type: "text" },
    ],
  },
  {
    id: "expenses",
    icon: "↘",
    uses: ["personal", "finance"],
    name: tr("Расходы", "Витрати", "Expenses", "Ausgaben", "Gastos"),
    description: tr(
      "Куда уходят деньги, по категориям",
      "Куди йдуть гроші, за категоріями",
      "Where the money goes, by category",
      "Wohin das Geld geht, nach Kategorie",
      "En qué se va el dinero, por categoría",
    ),
    why: tr(
      "Скажите «такси 450» — запись готова. Не нужно открывать таблицу на телефоне.",
      "Скажіть «таксі 450» — запис готовий. Не треба відкривати таблицю на телефоні.",
      "Say “taxi 450” and the entry is done. No squinting at a sheet on your phone.",
      "Sagen Sie „Taxi 450“ — fertig. Kein Gefummel mit einer Tabelle am Handy.",
      "Di «taxi 450» y listo. Sin pelearte con una hoja en el móvil.",
    ),
    when: tr(
      "Деньги куда-то утекают и хочется понять куда.",
      "Гроші кудись витікають і хочеться зрозуміти куди.",
      "Money keeps disappearing and you want to know where.",
      "Das Geld verschwindet und Sie wollen wissen, wohin.",
      "El dinero se esfuma y quieres saber en qué.",
    ),
    columns: (l) => [
      { name: N.date[l], type: "date" },
      { name: N.category[l], type: "select", options: expenseCategories(l) },
      { name: N.amount[l], type: "money" },
      { name: N.note[l], type: "text" },
    ],
  },
  {
    id: "savings",
    icon: "◔",
    uses: ["personal"],
    name: tr("Копилка", "Скарбничка", "Savings", "Sparschwein", "Hucha"),
    description: tr(
      "Сколько и когда отложил",
      "Скільки й коли відклав",
      "What you saved and when",
      "Was du wann gespart hast",
      "Cuánto y cuándo ahorraste",
    ),
    why: tr(
      "Три колонки и итог сверху. Ничего настраивать не нужно.",
      "Три колонки й підсумок зверху. Нічого налаштовувати не треба.",
      "Three columns and the total on top. Nothing to set up.",
      "Drei Spalten, die Summe oben. Nichts einzurichten.",
      "Tres columnas y el total arriba. Nada que configurar.",
    ),
    when: tr(
      "Копите на цель и хотите видеть прогресс.",
      "Накопичуєте на ціль і хочете бачити прогрес.",
      "You're saving for something and want to see progress.",
      "Sie sparen auf etwas und wollen den Fortschritt sehen.",
      "Ahorras para algo y quieres ver cómo avanzas.",
    ),
    columns: (l) => [
      { name: N.date[l], type: "date" },
      { name: N.amount[l], type: "money" },
      { name: N.note[l], type: "text" },
    ],
  },
  {
    id: "debts",
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
    columns: (l) => [
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
    ],
  },
];

export function templatesFor(use: UseCase): Template[] {
  if (use === "other") return TEMPLATES;
  return TEMPLATES.filter((t) => t.uses.includes(use));
}
