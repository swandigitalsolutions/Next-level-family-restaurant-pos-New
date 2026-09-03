import { specialities } from "@/lib/content";

export default function Specialities() {
  return (
    <div className="specialities">
      {specialities.map((s) => (
        <div className="spec" key={s.title}>
          <span className="ico" aria-hidden="true">
            {s.ico}
          </span>
          <h3>{s.title}</h3>
          <p>{s.text}</p>
        </div>
      ))}
    </div>
  );
}
