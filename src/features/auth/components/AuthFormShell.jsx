import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/core/ui/card';

export function AuthFormShell({ title, description, children, footer }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      <Card className="w-full max-w-lg border-white/80 bg-white/95">
        <CardHeader className="space-y-3 text-right">
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription className="text-sm leading-6">{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {children}
          {footer}
        </CardContent>
      </Card>
    </motion.div>
  );
}

