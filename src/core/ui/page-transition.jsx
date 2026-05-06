import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

const transition = {
  duration: 0.14,
  ease: [0.16, 1, 0.3, 1],
};

function getPageMotion() {
  return {
    initial: {
      opacity: 0,
    },
    animate: {
      opacity: 1,
    },
    exit: {
      opacity: 0,
    },
  };
}

export function PageTransition({ children, pathname }) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className="flex min-h-full flex-col">{children}</div>;
  }

  const pageMotion = getPageMotion(pathname);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={pageMotion.initial}
        animate={pageMotion.animate}
        exit={pageMotion.exit}
        transition={transition}
        className="flex min-h-full flex-col overflow-hidden will-change-transform"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
