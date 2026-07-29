"use client";

interface HeaderProps {
  lbOpen?: boolean;
}

export default function Header({ lbOpen = false }: HeaderProps) {
  return (
    <header
      className={`fixed top-0 left-0 right-0 px-[52px] py-[38px] flex justify-between items-center z-[200] transition-opacity duration-300 ${
        lbOpen ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div className="font-serif font-light text-[0.95rem] text-text tracking-[0.22em] uppercase">
        Mỹ Duyên
      </div>
      <nav className="flex gap-10">
        {["Work", "About", "Contact"].map((t) => (
          <a
            key={t}
            href="#"
            className="font-mono text-[0.58rem] text-muted tracking-[0.18em] uppercase transition-colors duration-300 hover:text-text cursor-none max-md:cursor-auto"
          >
            {t}
          </a>
        ))}
      </nav>
    </header>
  );
}
