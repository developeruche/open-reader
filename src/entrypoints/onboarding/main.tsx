import { createRoot } from 'react-dom/client';
import { PlaceholderShell } from '@/ui/PlaceholderShell';
import '@/ui/tokens.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<PlaceholderShell title="Welcome to Open Reader" />);
