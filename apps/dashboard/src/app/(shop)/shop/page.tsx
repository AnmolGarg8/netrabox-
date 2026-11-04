import Link from "next/link";
import { ArrowLeft, ShoppingCart } from "lucide-react";

const PRODUCTS = [
  {
    id: "prod_headphones_01",
    name: "Sony WH-1000XM5 Wireless Headphones",
    price: "$349.99",
    priceMinor: 34999,
    category: "Audio",
    description: "Industry-leading noise canceling with Auto NC Optimizer and two processors.",
  },
  {
    id: "prod_chair_02",
    name: "Ergonomic Mesh Task Chair",
    price: "$199.50",
    priceMinor: 19950,
    category: "Office",
    description: "Breathable responsive mesh back with adjustable lumbar support.",
  },
  {
    id: "prod_keyboard_03",
    name: "Wireless Mechanical Split Keyboard",
    price: "$129.00",
    priceMinor: 12900,
    category: "Peripherals",
    description: "Hot-swappable switches with Bluetooth multi-device pairing.",
  },
];

export default function ShopPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to NetraBox
          </Link>
          <span className="text-slate-600">|</span>
          <span className="font-semibold text-white">TechHaven — Mock Merchant Store</span>
        </div>
        <div className="text-xs text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
          Agent Sandbox Playground
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white">Storefront Catalog</h2>
          <p className="text-sm text-slate-400">
            Simulated merchant shop where AI shopping agents evaluate offers and initiate
            NetraBox-recorded PayPal purchases.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PRODUCTS.map((product) => (
            <div
              key={product.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between"
            >
              <div>
                <span className="text-xs font-mono text-indigo-400 uppercase tracking-wider">
                  {product.category}
                </span>
                <h3 className="text-lg font-semibold text-white mt-1 mb-2">{product.name}</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">{product.description}</p>
              </div>
              <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-xl font-bold text-emerald-400">{product.price}</span>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Agent Buy
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
