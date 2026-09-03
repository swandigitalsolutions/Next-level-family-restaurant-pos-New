import { menu } from "@/lib/menu";

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function MenuList() {
  return (
    <div className="menu-cols">
      {menu.map((section) => (
        <div className="menu-block" key={section.category}>
          <h3 id={slug(section.category)}>{section.category}</h3>
          {section.items.map((it) => (
            <div className="menu-row" key={it.name}>
              <div>
                <div className="n">{it.name}</div>
                <div className="d">{it.desc}</div>
              </div>
              <div className="p">{it.price}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
