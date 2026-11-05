#include <stddef.h>
#include <stdio.h>

#define WINDOW_SIZE 4

typedef struct {
    double values[WINDOW_SIZE];
    size_t next;
    size_t count;
    double sum;
} RollingAverage;

static double push(RollingAverage *window, double value) {
    if (window->count == WINDOW_SIZE) {
        window->sum -= window->values[window->next];
    } else {
        window->count++;
    }
    window->values[window->next] = value;
    window->sum += value;
    window->next = (window->next + 1) % WINDOW_SIZE;
    return window->sum / (double)window->count;
}

int main(void) {
    RollingAverage temperature = {0};
    const double samples[] = {17.2, 17.4, 18.1, 17.8, 18.3};
    for (size_t i = 0; i < sizeof(samples) / sizeof(samples[0]); ++i) {
        printf("sample=%zu average=%.2f\n", i + 1, push(&temperature, samples[i]));
    }
    return 0;
}
