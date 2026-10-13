import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { Background } from "./components/Background";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import Home from "./pages/Home";

const MyLoan = lazy(() => import("./pages/MyLoan"));
const Demo = lazy(() => import("./pages/Demo"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const Compare = lazy(() => import("./pages/Compare"));
const Market = lazy(() => import("./pages/Market"));
const Developers = lazy(() => import("./pages/Developers"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Shell() {
  const location = useLocation();
  return (
    <>
      <Background />
      <a href="#main" className="skip">Skip to content</a>
      <Nav />
      <AnimatePresence mode="wait" onExitComplete={() => window.scrollTo({ top: 0 })}>
        <motion.main
          id="main"
          key={location.pathname}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
            <Routes location={location}>
              <Route path="/" element={<Home />} />
              <Route path="/app" element={<MyLoan />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/market" element={<Market />} />
              <Route path="/developers" element={<Developers />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </motion.main>
      </AnimatePresence>
      <Footer />
    </>
  );
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </MotionConfig>
  );
}
