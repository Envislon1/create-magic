import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="py-12 px-4 bg-section-blue text-section-blue-foreground border-t border-white/20">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h3 className="text-lg font-semibold mb-4 uppercase tracking-wide">Contact</h3>
          <div className="flex justify-center gap-6 mb-6">
            <a href="https://www.facebook.com/profile.php?id=100076971684775&mibextid=ZbWKwL" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </a>
            <a href="mailto:littlestarskiddies.org@gmail.com" className="hover:text-primary transition">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            </a>
          </div>
          <nav className="flex flex-wrap justify-center gap-4 text-sm">
            <Link to="/leaderboard" className="hover:text-primary transition">Vote</Link>
            <Link to="/terms" className="hover:text-primary transition">Terms & Conditions</Link>
          </nav>
        </div>
        <div className="text-center text-sm opacity-80 border-t border-white/20 pt-6">
          <p className="uppercase tracking-wide mb-1">Copyright</p>
          <p>Little Stars Kiddies 2026</p>
          <p className="mt-3 text-xs opacity-70">Powered by Creativekids hub</p>
        </div>
      </div>
    </footer>
  );
}
