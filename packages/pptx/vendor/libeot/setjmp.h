#ifndef FILENS_EOT_SETJMP_H
#define FILENS_EOT_SETJMP_H

/* A fatal decode error ends the one-shot worker instead of recovering in C. */
typedef int jmp_buf;
#define setjmp(env) 0
#define longjmp(env, error) __builtin_trap()

#endif
