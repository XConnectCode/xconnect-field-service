import { useState } from 'react';
import { Outlet, Navigate } from 'react-router';
import { useAuth } from './lib/auth-context';
import { Menu } from 'lucide-react';
// Notice the added /ui/ and the lowercase 's' here!
import Sidebar from './components/ui/sidebar';

export default function Root() {
  const { loading, user } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Keep your loading state while auth initializes
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // No active session — send the user to the sign-in page. /login and /setup
  // are mounted outside of Root so they remain reachable.
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* 1. Inject your new Sidebar component */}
      <Sidebar isOpen={isMobileMenuOpen} setIsOpen={setIsMobileMenuOpen} />

      {/* 2. Main Content Area */}
      <main
        className="flex-1 flex flex-col overflow-auto transition-all duration-200 md:ml-[240px]"
      >
        {/* Mobile Header (Hidden on desktop) */}
        <header className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 -ml-2 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none"
            >
              <Menu size={24} />
            </button>
            <span className="font-bold text-lg text-slate-800 dark:text-slate-100">XConnect</span>
          </div>
        </header>

        <div className="flex-1 p-2 md:p-6 overflow-x-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
