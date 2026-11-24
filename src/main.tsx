import { createRoot } from "react-dom/client";
import Photobooth from "./photobooth/Photobooth";
import { configurationError } from "./config";
import "./styles.css";

const error = configurationError();
createRoot(document.getElementById("root")!).render(
  error ? <main className="p-8"><h1>Revisa la configuración</h1><p>{error}</p></main> : <Photobooth />,
);
