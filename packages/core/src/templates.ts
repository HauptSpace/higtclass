import type { ColumnDraft } from "./commands.ts";
import type { Locale } from "./types.ts";

// Ready-made starting points, so nobody faces an empty sheet.
// Every name is translated; formulas are built from the translated names.

type L10n = Record<Locale, string>;

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
  phone: tr("Телефон", "Телефон", "Phone", "Telefon", "Teléfono"),
  status: tr("Статус", "Статус", "Status", "Status", "Estado"),
  paid: tr("Оплачено", "Оплачено", "Paid", "Bezahlt", "Pagado"),
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

export interface Template {
  id: string;
  icon: string;
  name: L10n;
  description: L10n;
  columns: (l: Locale) => ColumnDraft[];
}

export const TEMPLATES: Template[] = [
  {
    id: "savings",
    icon: "🐷",
    name: tr("Копилка", "Скарбничка", "Savings", "Sparschwein", "Hucha"),
    description: tr(
      "Сколько и когда отложил",
      "Скільки й коли відклав",
      "What you saved and when",
      "Was du wann gespart hast",
      "Cuánto y cuándo ahorraste",
    ),
    columns: (l) => [
      { name: N.date[l], type: "date" },
      { name: N.amount[l], type: "money" },
      { name: N.note[l], type: "text" },
    ],
  },
  {
    id: "expenses",
    icon: "🧾",
    name: tr("Расходы", "Витрати", "Expenses", "Ausgaben", "Gastos"),
    description: tr(
      "Куда уходят деньги, по категориям",
      "Куди йдуть гроші, за категоріями",
      "Where the money goes, by category",
      "Wohin das Geld geht, nach Kategorie",
      "En qué se va el dinero, por categoría",
    ),
    columns: (l) => [
      { name: N.date[l], type: "date" },
      { name: N.category[l], type: "select", options: expenseCategories(l) },
      { name: N.amount[l], type: "money" },
      { name: N.note[l], type: "text" },
    ],
  },
  {
    id: "budget",
    icon: "💰",
    name: tr("Доходы и расходы", "Доходи та витрати", "Income & expenses", "Einnahmen & Ausgaben", "Ingresos y gastos"),
    description: tr(
      "Всё движение денег в одном месте",
      "Увесь рух грошей в одному місці",
      "All your cash flow in one place",
      "Alle Geldflüsse an einem Ort",
      "Todo tu dinero en un solo lugar",
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
    id: "inventory",
    icon: "📦",
    name: tr("Склад", "Склад", "Inventory", "Lager", "Inventario"),
    description: tr(
      "Товары, остатки и стоимость",
      "Товари, залишки та вартість",
      "Items, stock and value",
      "Artikel, Bestand und Wert",
      "Artículos, stock y valor",
    ),
    columns: (l) => [
      { name: N.item[l], type: "text" },
      { name: N.qty[l], type: "number" },
      { name: N.price[l], type: "money" },
      { name: N.total[l], type: "formula", formula: `[${N.qty[l]}] * [${N.price[l]}]` },
    ],
  },
  {
    id: "orders",
    icon: "🤝",
    name: tr("Клиенты и заказы", "Клієнти та замовлення", "Clients & orders", "Kunden & Aufträge", "Clientes y pedidos"),
    description: tr(
      "Кто заказал, сколько и оплатил ли",
      "Хто замовив, скільки та чи оплатив",
      "Who ordered, how much, and if they paid",
      "Wer bestellt hat, wie viel und ob bezahlt",
      "Quién pidió, cuánto y si pagó",
    ),
    columns: (l) => [
      { name: N.date[l], type: "date" },
      { name: N.client[l], type: "text" },
      { name: N.phone[l], type: "text" },
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
];
