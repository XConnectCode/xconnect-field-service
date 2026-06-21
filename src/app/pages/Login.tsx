import { useState } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { useTheme } from '../lib/theme-context';
import { XCONNECT_LOGO_B64, XCONNECT_LOGO_UI_DARK_B64 } from '../lib/brandAssets';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { toast } from 'sonner';

export default function Login() {
  const [googleLoading, setGoogleLoading] = useState(false);
  const { signInWithGoogle, user } = useAuth();
  const { isDark } = useTheme();

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      // signInWithOAuth triggers a full-page redirect to Google, so we won't
      // typically reach the code below — keep the spinner on until it does.
    } catch (error: any) {
      toast.error(
        error?.message
          ? `Google sign-in failed: ${error.message}`
          : 'Google sign-in failed. Please try again.'
      );
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-gray-100 dark:from-gray-900 dark:to-gray-950 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          {/* Official XConnect logo, swapped for the active theme. */}
          <img
            src={isDark ? XCONNECT_LOGO_UI_DARK_B64 : XCONNECT_LOGO_B64}
            alt="XConnect"
            className="h-9 w-auto mb-3"
          />
          <CardTitle className="text-2xl font-bold">Field Service Management</CardTitle>
          <CardDescription>
            Sign in to access your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogle}
            disabled={googleLoading}
          >
            <GoogleLogo className="mr-2 h-4 w-4" aria-hidden="true" />
            {googleLoading ? 'Redirecting to Google…' : 'Continue with Google'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function GoogleLogo({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.165 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
