import { startDashboardServer } from '../src/dashboard.js';

const fake = [
  {
    id: 'abc123', href: 'https://x/1', game: 'clash_royale', category: 'Trophy Boosting',
    description: 'Current trophies: 11800 Desired trophies: 14000',
    buyer: 'FancyPet-yQ4K', price: 35, priceMin: 28, priceMax: 42, eta: '3-5 days', etaLabel: '7 days',
  },
  {
    id: 'def456', href: 'https://x/2', game: 'brawl_stars', category: 'Custom Request',
    description: '74 brawlers to prestige 1',
    buyer: 'SharpFlash-Hlq6', price: 60, priceMin: 48, priceMax: 72, eta: '1 week', etaLabel: '7 days',
  },
];

startDashboardServer(() => fake, 3199);

const res = await fetch('http://localhost:3199/api/dashboard');
const json = await res.json();
console.log('API OK, requests:', json.requests.length);
const page = await fetch('http://localhost:3199/');
const html = await page.text();
console.log('HTML OK, contiene titulo:', html.includes('Panel Eldorado'));

process.exit(0);
