import './styles.css';
import { createRoot } from 'react-dom/client';
import { TheaterApp } from './theater/TheaterApp';

const rootEl = document.getElementById('theaterRoot');
if (rootEl) {
  createRoot(rootEl).render(<TheaterApp />);
}
