import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Database, Cpu, BrainCircuit, Zap,
  BarChart2, Activity, TrendingUp, Rocket, HeartPulse,
  ChevronRight,
} from "lucide-react";

const NAV = [
  { to: "/",             icon: LayoutDashboard, label: "Overview"       },
  { to: "/datasets",     icon: Database,        label: "Datasets"       },
  { to: "/training",     icon: Cpu,             label: "Training"       },
  { to: "/models",       icon: BrainCircuit,    label: "Models"         },
  { to: "/predictions",  icon: Zap,             label: "Predictions"    },
  { to: "/eda",          icon: BarChart2,        label: "EDA"            },
  { to: "/drift",        icon: Activity,        label: "Drift Detection" },
  { to: "/forecasting",  icon: TrendingUp,      label: "Forecasting"    },
  { to: "/deployments",  icon: Rocket,          label: "Deployments"    },
  { to: "/health",       icon: HeartPulse,      label: "System Health"  },
];

export default function Sidebar() {
  return (
    <aside style={{
      width: "var(--sidebar-w)",
      flexShrink: 0,
      background: "var(--bg-surface)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      position: "sticky",
      top: 0,
      overflowY: "auto",
    }}>
      {/* Brand */}
      <div style={{
        padding: "20px 20px 16px",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34,
            background: "var(--accent)",
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <BrainCircuit size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
              AutoML
            </div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 500 }}>
              Platform v2.0
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "12px 10px", flex: 1 }}>
        <p style={{
          fontSize: 10, fontWeight: 600, color: "var(--text-disabled)",
          letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "0 10px", marginBottom: 6,
        }}>
          Navigation
        </p>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              background: isActive ? "var(--accent-dim)" : "transparent",
              border: isActive ? "1px solid var(--accent-border)" : "1px solid transparent",
              marginBottom: 2,
              transition: "all var(--t-fast)",
              textDecoration: "none",
            })}
          >
            {({ isActive }) => (
              <>
                <Icon size={15} color={isActive ? "var(--accent)" : "currentColor"} />
                <span style={{ flex: 1 }}>{label}</span>
                {isActive && <ChevronRight size={12} color="var(--accent)" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div style={{
        padding: "12px 20px",
        borderTop: "1px solid var(--border-subtle)",
        fontSize: 11,
        color: "var(--text-disabled)",
      }}>
        AutoGluon 1.6.1 · FastAPI 0.141
      </div>
    </aside>
  );
}
