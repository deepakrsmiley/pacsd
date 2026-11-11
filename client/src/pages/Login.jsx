import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { homeFor, useAuth } from "../auth.jsx";
import Logo from "../logo.jsx";

export default function Login() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [resetHelp, setResetHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  if (ready && user) return <Navigate to={homeFor(user)} replace />;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const signedIn = await login(email, password);
      navigate(homeFor(signedIn));
    } catch (err) {
      setError(err.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-apple flex h-full min-h-0 flex-col bg-[#0b0b0f] text-[#f5f5f7]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0b0c10] px-6 lg:hidden">
        <Logo className="h-8 w-auto opacity-90" />
        <p className="text-[12px] font-semibold tracking-[0.22em] text-zinc-300">PACSD</p>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="relative hidden w-[420px] shrink-0 flex-col justify-between overflow-hidden border-r border-white/[0.08] bg-[#101014] px-12 py-12 lg:flex">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(91,33,182,0.32),transparent_58%)]" />
          <div className="relative">
            <Logo className="h-auto w-[188px] opacity-90" />
            <h1 className="mt-16 text-5xl font-semibold tracking-tight text-white">PACSD</h1>
            <p className="mt-5 max-w-sm text-[15px] leading-7 text-zinc-400">
              Secure access to the radiology workspace for study review, reporting, and facility administration.
            </p>
          </div>
          <CompanyHighlights />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1">
            <section className="relative hidden w-[318px] shrink-0 flex-col justify-between overflow-hidden border-r border-white/[0.08] bg-[#121018] px-8 py-10 md:flex lg:hidden">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(91,33,182,0.42),transparent_62%)]" />
              <div className="relative">
                <Logo className="mb-7 h-auto w-[156px] opacity-90" />
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-300">Authorized access</p>
                <h2 className="mt-6 text-[32px] font-semibold leading-[1.15] tracking-tight text-white">Imaging workspace</h2>
                <p className="mt-4 text-sm leading-6 text-zinc-400">
                  Study review, reporting, and facility administration for issued staff accounts.
                </p>
              </div>
              <CompanyHighlights className="relative" />
            </section>

            <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(76,29,149,0.14),transparent_55%)]" />
              <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]" />

              <form onSubmit={submit} className="relative w-full max-w-[420px] rounded-[28px] bg-white/[0.04] p-8 shadow-2xl shadow-black/50 ring-1 ring-white/[0.08] backdrop-blur-2xl sm:p-10">
                    <p className="text-[13px] font-semibold text-violet-300">Staff sign-in</p>
                    <h2 className="mt-2 text-[30px] font-bold tracking-[-0.02em] text-white">Welcome back</h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      Enter the credentials issued for your facility account.
                    </p>

                    <div className="mt-8 space-y-5">
                      <div>
                        <label htmlFor="email" className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Email</label>
                        <input
                          id="email"
                          className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-[15px] text-white outline-none transition placeholder:text-white/30 focus:border-violet-400/60 focus:bg-white/[0.08] focus:ring-4 focus:ring-violet-500/15"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          type="email"
                          autoComplete="username"
                          placeholder="name@facility.org"
                          required
                        />
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Password</label>
                          <button
                            type="button"
                            className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 hover:text-zinc-200"
                            onClick={() => setShowPassword((value) => !value)}
                          >
                            {showPassword ? "Hide" : "Show"}
                          </button>
                        </div>
                        <input
                          id="password"
                          className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-[15px] text-white outline-none transition focus:border-violet-400/60 focus:bg-white/[0.08] focus:ring-4 focus:ring-violet-500/15"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          required
                        />
                        <button
                          type="button"
                          className="mt-2 text-xs font-semibold text-violet-200 underline-offset-2 hover:underline"
                          onClick={() => setResetHelp(true)}
                        >
                          Forgot password?
                        </button>
                        {resetHelp && (
                          <p className="mt-2 text-xs leading-5 text-zinc-200" role="status">
                            Email password reset is not available yet. Contact your facility administrator to reset the account.
                          </p>
                        )}
                      </div>
                    </div>

                    {error && (
                      <p className="mt-4 border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100" role="alert">
                        {error}
                      </p>
                    )}

                    <button
                      className="mt-7 h-12 w-full rounded-full bg-gradient-to-b from-[#8b5cf6] to-[#6d28d9] text-[15px] font-semibold text-white shadow-lg shadow-violet-900/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition hover:from-[#8b5cf6] hover:to-[#6d28d9] disabled:cursor-wait disabled:opacity-60"
                      disabled={busy}
                    >
                      {busy ? "Signing in…" : "Sign in"}
                    </button>
                    <p className="mt-4 text-center text-xs leading-5 text-zinc-300">
                      Access is limited to credentials issued for your facility.
                    </p>
                  </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function CompanyHighlights({ className = "" }) {
  const words = ["Imaging", "Diagnostics", "Clinical care"];
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">About</p>
      <p className="mt-3 text-sm font-medium tracking-tight text-zinc-200">Galactic Medical Systems</p>
      <p className="mt-1 text-[13px] leading-6 text-zinc-300">
        Enterprise imaging for hospitals and diagnostic facilities.
      </p>
      <ul className="mt-4 flex flex-wrap gap-1.5">
        {words.map((word) => (
          <li key={word} className="rounded-full bg-white/[0.06] px-3 py-1 text-[12px] font-medium text-white/70">
            {word}
          </li>
        ))}
      </ul>
    </div>
  );
}
