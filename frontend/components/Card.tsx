import clsx from "clsx";

type CardProps = {
  title?: string;
  subtitle?: string;
  className?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
};

export default function Card({ title, subtitle, className, headerRight, children }: CardProps) {
  return (
    <section className={clsx("card", className)}>
      {(title || subtitle || headerRight) ? (
        <header className="card-header">
          <div>
            {title ? <h2 className="card-title">{title}</h2> : null}
            {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
          </div>
          {headerRight ? <div className="card-header-right">{headerRight}</div> : null}
        </header>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  );
}
