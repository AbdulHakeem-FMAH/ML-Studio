import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar.jsx";
import Overview     from "./pages/Overview.jsx";
import Datasets     from "./pages/Datasets.jsx";
import Training     from "./pages/Training.jsx";
import Models       from "./pages/Models.jsx";
import Predictions  from "./pages/Predictions.jsx";
import EDA          from "./pages/EDA.jsx";
import Drift        from "./pages/Drift.jsx";
import Forecasting  from "./pages/Forecasting.jsx";
import Deployments  from "./pages/Deployments.jsx";
import Health       from "./pages/Health.jsx";

export default function App() {
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-base)" }}>
        <Routes>
          <Route path="/"            element={<Overview    />} />
          <Route path="/datasets"    element={<Datasets    />} />
          <Route path="/training"    element={<Training    />} />
          <Route path="/models"      element={<Models      />} />
          <Route path="/predictions" element={<Predictions />} />
          <Route path="/eda"         element={<EDA         />} />
          <Route path="/drift"       element={<Drift       />} />
          <Route path="/forecasting" element={<Forecasting />} />
          <Route path="/deployments" element={<Deployments />} />
          <Route path="/health"      element={<Health      />} />
        </Routes>
      </main>
    </div>
  );
}
