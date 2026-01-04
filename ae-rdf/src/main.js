"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vue_1 = require("vue");
var pinia_1 = require("pinia");
var config_1 = require("primevue/config");
var aura_1 = require("@primevue/themes/aura");
var App_vue_1 = require("./App.vue");
require("primeicons/primeicons.css");
require("@ae/styles");
require("./style.css");
var app = (0, vue_1.createApp)(App_vue_1.default);
// Pinia
var pinia = (0, pinia_1.createPinia)();
app.use(pinia);
// PrimeVue
app.use(config_1.default, {
    theme: {
        preset: aura_1.default,
        options: {
            darkModeSelector: '.dark-mode',
            cssLayer: false,
        },
    },
});
app.mount('#app');
