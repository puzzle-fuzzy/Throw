import { Toast } from '@heroui/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    {/* Toast.Provider 是 Toast 队列渲染区域（ToastRegion），不透传应用内容，与 App 平级挂载 */}
    <Toast.Provider />
  </StrictMode>,
);
