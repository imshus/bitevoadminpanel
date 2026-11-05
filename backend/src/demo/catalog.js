// Demo catalogue, team and people used to seed an empty database (see demo/seedData.js).
import { rng, pick, intBetween, weighted } from '../lib/random.js';

const DAY = 86400000;
const MIN = 60000;

// Stable 24-hex ids so the simulated order history can reference seed documents.
const seedId = (kind, n) => `66f0${kind}${n.toString(16).padStart(18, '0')}`;
const photo = id => `https://images.unsplash.com/photo-${id}?w=240&h=240&fit=crop&q=70&auto=format`;

export const CATEGORIES = [
  { key: 'biryani', label: 'Biryani' },
  { key: 'meals', label: 'Indian Meals' },
  { key: 'fastfood', label: 'Burgers & Pizza' },
  { key: 'snacks', label: 'Snacks' },
  { key: 'sweets', label: 'Desserts & Drinks' },
  { key: 'combos', label: 'Combos' },
];

export const VEHICLES = ['Bike', 'Scooter', 'E-bike', 'Bicycle'];

// Demo admin accounts. Passwords are hashed with bcrypt before they are stored.
export const ADMINS = [
  { _id: seedId('ad', 1), name: 'BiteVo Admin', email: 'admin@gmail.com', password: 'admin', role: 'Super admin' },
  { _id: seedId('ad', 2), name: 'Ops Manager', email: 'ops@bitevo.in', password: 'bitevo@ops', role: 'Operations' },
];

// Menu items from the public website, with example prices.
// `popularity` only drives the simulated order history; it is not part of the product document.
const PRODUCT_ROWS = [
  ['biryani', 'Chicken Biryani', 249, 279, false, '1631515243349-e0cb75fb8d3a', 'Fragrant basmati rice slow-cooked with tender chicken and whole spices.', 25, true, true, 14],
  ['biryani', 'Dum Biryani', 279, 299, false, '1589302168068-964664d93dc0', 'Layered, sealed and cooked slowly on dum for deep flavour.', 30, true, false, 9],
  ['biryani', 'Biryani Platter', 549, 599, false, '1633945274405-b6c8069047b0', 'A generous, family-size biryani made for sharing.', 35, false, false, 3],
  ['meals', 'Butter Chicken', 289, null, false, '1603894584373-5ac82b2ae398', 'Chargrilled chicken in a rich, creamy tomato gravy.', 25, true, true, 10],
  ['meals', 'Paneer Tikka', 229, null, true, '1567188040759-fb8a883dc6d8', 'Smoky paneer cubes marinated in yogurt and spices.', 20, true, false, 7],
  ['meals', 'Veg Thali', 199, 229, true, '1742281258189-3b933879867a', 'A complete meal with a little bit of everything.', 20, true, false, 8],
  ['meals', 'Masala Dosa', 129, null, true, '1668236543090-82eba5ee5976', 'Crispy dosa with potato masala, sambar and chutneys.', 15, true, false, 7],
  ['fastfood', 'Classic Burger', 149, 169, false, '1568901346375-23c9450c58cd', 'A juicy patty with fresh lettuce, tomato and house sauce.', 15, true, true, 11],
  ['fastfood', 'Margherita Pizza', 249, null, true, '1513104890138-7c749659a591', 'Rich tomato sauce and melty cheese on a fresh base.', 20, true, false, 8],
  ['fastfood', 'Loaded Pizza', 349, 399, false, '1604382354936-07c5d9983bd3', 'Piled high with toppings for serious cravings.', 25, true, false, 6],
  ['fastfood', 'Grilled Wrap', 159, null, false, '1666819615040-eff5e52c778a', 'A soft wrap packed with grilled filling and crunchy veggies.', 12, true, false, 5],
  ['snacks', 'Steamed Momos', 119, null, true, '1694923450868-b432a8ee52aa', 'Soft dumplings served with a fiery red chutney.', 15, true, true, 9],
  ['snacks', 'Samosa', 49, null, true, '1601050690597-df0568f70950', 'Golden, crisp pastry with a spiced potato filling.', 10, true, false, 6],
  ['snacks', 'French Fries', 99, null, true, '1518013431117-eb1465fa5752', 'Crispy, golden and perfectly salted.', 10, true, false, 8],
  ['snacks', 'Hakka Noodles', 169, null, true, '1617622141675-d3005b9067c5', 'Wok-tossed noodles with crunchy vegetables.', 15, true, false, 5],
  ['sweets', 'Indian Sweets', 149, null, true, '1758910536889-43ce7b3199fd', 'A selection of classic mithai for your sweet tooth.', 5, true, false, 3],
  ['sweets', 'Cookies & Cream Shake', 159, null, true, '1572490122747-3968b75cc699', 'Thick, creamy and loaded with cookie crumbs.', 8, true, false, 4],
  ['sweets', 'Strawberry Shake', 149, null, true, '1579954115545-a95591f28bfc', 'Sweet, fruity and blended until smooth.', 8, true, false, 3],
  ['sweets', 'Cold Coffee', 129, null, true, '1517701550927-30cf4ba1dba5', 'Chilled, creamy coffee for an instant pick-me-up.', 5, true, false, 5],
  ['sweets', 'Rose Lassi', 99, null, true, '1692620609860-be6717812f71', 'Cool, creamy yogurt drink with a hint of rose.', 5, false, false, 2],
];

// Optional short heading shown above a dish name in the app.
const HEADINGS = { 'Chicken Biryani': 'Chef’s special', 'Veg Thali': 'Value meal', 'Loaded Pizza': 'Extra cheesy', 'Cold Coffee': 'New' };

export const SEED_PRODUCTS = PRODUCT_ROWS.map(
  ([category, name, price, mrp, isVeg, img, description, prepTimeMins, isAvailable, isBestseller, popularity], i) => ({
    _id: seedId('a1', i + 1),
    name, heading: HEADINGS[name] || '', category, price, mrp, isVeg, description, prepTimeMins, isAvailable, isBestseller,
    image: photo(img),
    popularity,
  }),
);

// Demo combos: bundles of the dishes above sold together at a combo price.
export function demoCombos(now = Date.now()) {
  const line = (name, qty = 1) => ({ productId: SEED_PRODUCTS.find(p => p.name === name)._id, name, qty });
  const at = days => new Date(now - days * DAY).toISOString();
  return [
    {
      _id: seedId('a1', 21), type: 'combo', name: 'Biryani Feast Combo', heading: 'Best value', category: 'combos',
      comboItems: [line('Chicken Biryani'), line('Samosa', 2), line('Cold Coffee')],
      price: 399, mrp: 476, isVeg: false, prepTimeMins: 25, isAvailable: true, isBestseller: true,
      description: 'Chicken biryani, two samosas and a cold coffee.', image: photo('1633945274405-b6c8069047b0'),
      createdAt: at(5), updatedAt: at(5),
    },
    {
      _id: seedId('a1', 22), type: 'combo', name: 'Burger Meal', heading: '', category: 'combos',
      comboItems: [line('Classic Burger'), line('French Fries'), line('Cold Coffee')],
      price: 299, mrp: 377, isVeg: false, prepTimeMins: 15, isAvailable: true, isBestseller: false,
      description: 'Classic burger with fries and a cold coffee.', image: photo('1568901346375-23c9450c58cd'),
      createdAt: at(8), updatedAt: at(8),
    },
  ];
}

// Coupons, with their validity window in days relative to today (negative = in the past).
// `share` only drives how often the simulated order history uses each code.
export const SEED_COUPONS = [
  { n: 1, code: 'WELCOME50', description: 'Flat ₹50 off on your first BiteVo order', discountType: 'flat', discountValue: 50, maxDiscount: null, minOrderValue: 199, usageLimit: 5000, perUserLimit: 1, firstOrderOnly: true, from: -150, to: 60, isActive: true, share: 26 },
  { n: 2, code: 'BITE20', description: '20% off up to ₹100', discountType: 'percent', discountValue: 20, maxDiscount: 100, minOrderValue: 299, usageLimit: 3000, perUserLimit: 3, firstOrderOnly: false, from: -90, to: 30, isActive: true, share: 30 },
  { n: 3, code: 'FREEDEL', description: 'Free delivery on orders above ₹149', discountType: 'free_delivery', discountValue: 0, maxDiscount: null, minOrderValue: 149, usageLimit: null, perUserLimit: 5, firstOrderOnly: false, from: -60, to: 90, isActive: true, share: 22 },
  { n: 4, code: 'BIRYANI99', description: '₹99 off on orders above ₹599', discountType: 'flat', discountValue: 99, maxDiscount: null, minOrderValue: 599, usageLimit: 400, perUserLimit: 2, firstOrderOnly: false, from: -45, to: 5, isActive: true, share: 9 },
  { n: 5, code: 'WEEKEND15', description: '15% off up to ₹75 on weekends', discountType: 'percent', discountValue: 15, maxDiscount: 75, minOrderValue: 249, usageLimit: 2000, perUserLimit: 4, firstOrderOnly: false, from: -30, to: 60, isActive: false, share: 12 },
  { n: 6, code: 'FESTIVE25', description: 'Festive special: 25% off up to ₹150', discountType: 'percent', discountValue: 25, maxDiscount: 150, minOrderValue: 399, usageLimit: 1500, perUserLimit: 2, firstOrderOnly: false, from: 10, to: 25, isActive: true, share: 0 },
  { n: 7, code: 'MONSOON30', description: 'Monsoon offer: 30% off up to ₹120', discountType: 'percent', discountValue: 30, maxDiscount: 120, minOrderValue: 299, usageLimit: 1000, perUserLimit: 2, firstOrderOnly: false, from: -150, to: -40, isActive: true, share: 18 },
  { n: 8, code: 'FREESAMOSA', description: 'A free Samosa on orders above ₹299', discountType: 'free_item', discountValue: 0, maxDiscount: null, freeItem: { productId: SEED_PRODUCTS[12]._id, name: 'Samosa', qty: 1 }, minOrderValue: 299, usageLimit: 1000, perUserLimit: 2, firstOrderOnly: false, from: -20, to: 40, isActive: true, share: 12 },
  { n: 9, code: 'WALLET10', description: '10% back in your BiteVo wallet', discountType: 'cashback', cashbackUnit: 'percent', discountValue: 10, maxDiscount: 50, minOrderValue: 249, usageLimit: 2000, perUserLimit: 3, firstOrderOnly: false, from: -25, to: 35, isActive: true, share: 12 },
].map(c => ({ ...c, _id: seedId('c0', c.n) }));

// Delivery agents. `joined` is days ago; `speed` is their typical delivery time in
// minutes; both only drive the simulated order history.
export const SEED_AGENTS = [
  { n: 1, name: 'Ravi Kumar', vehicleType: 'Bike', status: 'online', kycStatus: 'verified', isActive: true, joined: 190, speed: 26 },
  { n: 2, name: 'Amit Sharma', vehicleType: 'Scooter', status: 'busy', kycStatus: 'verified', isActive: true, joined: 190, speed: 29 },
  { n: 3, name: 'Suresh Yadav', vehicleType: 'Bike', status: 'online', kycStatus: 'verified', isActive: true, joined: 160, speed: 31 },
  { n: 4, name: 'Mohd. Imran', vehicleType: 'Bike', status: 'busy', kycStatus: 'verified', isActive: true, joined: 140, speed: 27 },
  { n: 5, name: 'Vikram Singh', vehicleType: 'E-bike', status: 'offline', kycStatus: 'verified', isActive: true, joined: 130, speed: 33 },
  { n: 6, name: 'Deepak Verma', vehicleType: 'Scooter', status: 'online', kycStatus: 'verified', isActive: true, joined: 110, speed: 28 },
  { n: 7, name: 'Priya Das', vehicleType: 'Scooter', status: 'busy', kycStatus: 'verified', isActive: true, joined: 95, speed: 25 },
  { n: 8, name: 'Rahul Gupta', vehicleType: 'Bicycle', status: 'offline', kycStatus: 'verified', isActive: true, joined: 80, speed: 38 },
  { n: 9, name: 'Arjun Nair', vehicleType: 'Bike', status: 'online', kycStatus: 'verified', isActive: true, joined: 60, speed: 30 },
  { n: 10, name: 'Sanjay Patel', vehicleType: 'Bike', status: 'offline', kycStatus: 'verified', isActive: false, joined: 120, speed: 41 },
  { n: 11, name: 'Karan Mehta', vehicleType: 'E-bike', status: 'offline', kycStatus: 'pending', isActive: true, joined: 3, speed: 30 },
  { n: 12, name: 'Manoj Tiwari', vehicleType: 'Bike', status: 'offline', kycStatus: 'pending', isActive: true, joined: 1, speed: 30 },
  { n: 13, name: 'Nitin Joshi', vehicleType: 'Scooter', status: 'offline', kycStatus: 'rejected', isActive: false, joined: 12, speed: 30 },
].map(a => ({
  ...a,
  _id: seedId('d0', a.n),
  phone: `+91 90000 ${String(100 + a.n).padStart(5, '0')}`,
  vehicleNumber: a.vehicleType === 'Bicycle' ? '' : `XX 01 ${String.fromCharCode(64 + ((a.n * 7) % 26) + 1)}${String.fromCharCode(64 + ((a.n * 3) % 26) + 1)} ${1000 + a.n * 731 % 9000}`,
}));

// Customers are generated on demand from these lists.
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishaan', 'Kabir', 'Meera', 'Riya', 'Saanvi', 'Arnav', 'Neha', 'Rohan', 'Pooja', 'Kunal', 'Sneha', 'Varun', 'Tanya', 'Yash', 'Kavya', 'Harsh', 'Nisha', 'Siddharth', 'Aisha', 'Dev', 'Ira', 'Manav', 'Shreya', 'Akash', 'Simran'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Patel', 'Reddy', 'Iyer', 'Nair', 'Das', 'Joshi', 'Mehta', 'Kapoor', 'Malhotra', 'Bose', 'Chopra', 'Mishra', 'Agarwal', 'Saxena', 'Khan'];

export const customerId = i => seedId('cc', i + 1);
export const customerName = i => `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 13 + Math.floor(i / FIRST.length)) % LAST.length]}`;
export const maskedPhone = i => `+91 ••••••${1000 + ((i * 7919) % 9000)}`;

const AGENT_DEVICE = 'Android · Delivery app 1.8';
const CUSTOMER_DEVICES = [
  { platform: 'android', device: 'Android · BiteVo app 2.4', w: 60 },
  { platform: 'ios', device: 'iPhone · BiteVo app 2.4', w: 28 },
  { platform: 'web', device: 'Chrome on Android · bitevo.in', w: 12 },
];
const ip = r => `${pick(r, [49, 103, 106, 117, 152, 157, 182, 223])}.${intBetween(r, 10, 250)}.${intBetween(r, 0, 255)}.${intBetween(r, 1, 254)}`;

function isoDaysFrom(now, days) {
  const d = new Date(now);
  d.setHours(days < 0 ? 0 : 23, days < 0 ? 0 : 59, 0, 0);
  return new Date(d.getTime() + days * DAY).toISOString();
}

// Builds the initial database. `now` is the moment the demo data is created.
export function createSeedData(now = Date.now()) {
  const r = rng(20261015);
  const at = msAgo => new Date(now - msAgo).toISOString();

  const singles = SEED_PRODUCTS.map(({ popularity, ...p }, i) => ({
    ...p,
    type: 'single',
    createdAt: at((150 + i) * DAY), // the first dish is the newest, so it lists first
    updatedAt: at((20 + i) * DAY),
  }));
  const products = [...singles, ...demoCombos(now)];

  const coupons = SEED_COUPONS.map(({ n, share, from, to, ...c }) => ({
    ...c,
    startsAt: isoDaysFrom(now, from),
    expiresAt: isoDaysFrom(now, to),
    createdAt: at((Math.max(-from, 0) + 2) * DAY),
    updatedAt: at(Math.max(-from, 0) * DAY),
  }));

  const agents = SEED_AGENTS.map(({ n, joined, speed, ...a }) => ({
    ...a,
    email: '',
    createdAt: at(joined * DAY),
    updatedAt: at(Math.min(joined, 4) * DAY),
  }));

  // Sessions and login history from the apps (customers, agents, other admins).
  const sessions = [];
  const loginEvents = [];
  const addSession = (s, loginAgo, activeAgo, revokedAgo = null) => {
    const _id = seedId('5e', sessions.length + 1);
    const ipAddr = ip(r);
    sessions.push({ _id, ...s, ip: ipAddr, loginAt: at(loginAgo), lastActiveAt: at(activeAgo), revokedAt: revokedAgo == null ? null : at(revokedAgo) });
    loginEvents.push({ _id: seedId('e0', loginEvents.length + 1), userId: s.userId, userName: s.userName, role: s.role, identifier: s.identifier, platform: s.platform, device: s.device, ip: ipAddr, success: true, reason: null, at: at(loginAgo) });
  };

  addSession({ userId: ADMINS[1]._id, userName: ADMINS[1].name, role: 'admin', identifier: ADMINS[1].email, platform: 'web', device: 'Chrome on Windows' }, 5 * 3600000, 23 * MIN);

  agents.forEach((a, i) => {
    const base = { userId: a._id, userName: a.name, role: 'agent', identifier: a.phone, platform: 'android', device: AGENT_DEVICE };
    if (a.status !== 'offline') addSession(base, intBetween(r, 2, 7) * 3600000, intBetween(r, 0, 3) * MIN);
    else if (a.kycStatus === 'verified' && a.isActive) addSession(base, intBetween(r, 14, 30) * 3600000, intBetween(r, 9, 12) * 3600000, intBetween(r, 8, 9) * 3600000);
    else if (a.kycStatus === 'pending') addSession(base, (i - 9) * 20 * 3600000, (i - 9) * 19 * 3600000);
  });

  for (let i = 0; i < 34; i++) {
    const c = intBetween(r, 0, 900);
    const dev = weighted(r, CUSTOMER_DEVICES, d => d.w);
    const loginAgo = intBetween(r, 10, 60 * 24 * 6) * MIN;
    const activeAgo = i < 9 ? intBetween(r, 0, 4) * MIN : Math.min(loginAgo, intBetween(r, 6, 60 * 30) * MIN);
    const revoked = i > 27 ? Math.max(activeAgo - 2 * MIN, 0) : null;
    addSession({ userId: customerId(c), userName: customerName(c), role: 'customer', identifier: maskedPhone(c), platform: dev.platform, device: dev.device }, loginAgo, activeAgo, revoked);
  }

  // Failed attempts: wrong OTPs, plus a burst of wrong admin passwords from one address.
  const failed = (who, ago, reason, ipAddr = ip(r)) =>
    loginEvents.push({ _id: seedId('e0', loginEvents.length + 1), ...who, ip: ipAddr, success: false, reason, at: at(ago) });
  const burstIp = ip(r);
  [41, 40, 38].forEach(m => failed({ userId: null, userName: 'Unknown', role: 'admin', identifier: 'admin@gmail.com', platform: 'web', device: 'Firefox on Linux' }, m * MIN + 3 * 3600000, 'Wrong password', burstIp));
  for (let i = 0; i < 6; i++) {
    const c = intBetween(r, 0, 900);
    failed({ userId: customerId(c), userName: customerName(c), role: 'customer', identifier: maskedPhone(c), platform: 'android', device: CUSTOMER_DEVICES[0].device }, intBetween(r, 20, 60 * 40) * MIN, pick(r, ['Invalid OTP', 'OTP expired']));
  }
  failed({ userId: agents[7]._id, userName: agents[7].name, role: 'agent', identifier: agents[7].phone, platform: 'android', device: AGENT_DEVICE }, 15 * 3600000, 'Invalid OTP');

  loginEvents.sort((a, b) => b.at.localeCompare(a.at));
  sessions.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

  // Wallet changes made by admins (cashback, refunds and wallet payments come from orders).
  const walletTxns = [
    [14, 250, 'Goodwill credit: order arrived late', 2],
    [57, 100, 'Referral bonus', 5],
    [91, 150, 'Compensation: item missing from order', 9],
    [8, 75, 'Birthday treat', 12],
    [57, -40, 'Reversed duplicate credit', 4],
    [203, 200, 'Goodwill credit: wrong item delivered', 20],
  ].map(([c, amount, note, daysAgo], i) => ({
    _id: seedId('a7', i + 1),
    customerId: customerId(c), customerName: customerName(c), customerPhone: maskedPhone(c),
    type: amount > 0 ? 'admin_credit' : 'admin_debit', amount, note, by: ADMINS[i % 2].name,
    at: at(daysAgo * DAY + intBetween(r, 1, 600) * MIN),
  }));

  const categories = CATEGORIES.map((c, i) => ({ _id: seedId('ca', i + 1), ...c, order: i + 1 }));

  return { categories, products, coupons, agents, sessions, loginEvents, walletTxns };
}
