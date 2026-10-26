# Segundo factor del panel

Desde el spec 0049, admin y staff entran al panel con la contraseña y un código de 6 dígitos de una app autenticadora (Google Authenticator, Microsoft Authenticator o 1Password).

## Primer ingreso

Después de la contraseña, el panel muestra un código QR y una clave en texto. Hay que escanear el QR con la app, o cargar la clave a mano, y escribir el código que muestra la app. A partir de ahí, cada ingreso pide el código.

Cuando se configura el factor, la persona recibe un correo de aviso. Si alguien recibe ese aviso sin haberlo hecho, tiene que avisar enseguida a un admin, que le resetea el factor.

## Alguien del equipo perdió el teléfono

1. Un admin entra al panel → **Usuarios** → en la fila de la persona, **Resetear segundo factor**.
2. Con eso:
   - se borra el factor;
   - se cambia la contraseña por una que nadie conoce;
   - se cierran las sesiones;
   - la persona recibe un correo para elegir una contraseña nueva.
3. La persona abre el correo, elige la contraseña nueva, entra y configura el factor en su teléfono nuevo.

Un admin no puede resetearse su propio factor desde el panel: se lo resetea otro admin. Por eso siempre tiene que haber al menos dos admins activos.

## Todos los admins perdieron el teléfono

Se resetea desde el dashboard de Supabase de producción:

1. Authentication → **Users** → buscar la cuenta del admin por correo.
2. En el detalle del usuario, sección **MFA factors**: borrar los factores.
3. En el panel, el admin entra con su contraseña y configura un factor nuevo.
4. Si además hay dudas sobre la contraseña, mandarle el correo de recuperación desde **¿Olvidaste tu contraseña?** en la pantalla de login.

## Si el código no funciona

- El código cambia cada 30 segundos: hay que usar el que muestra la app en ese momento.
- Si sigue fallando, revisar que la hora del teléfono esté en automático.
- Después de 10 intentos fallidos en 15 minutos, el panel pide esperar unos minutos.

## Límites contra la fuerza bruta del código

- El panel corta a los 10 intentos cada 15 minutos por usuario.
- Quien tenga la contraseña y la sesión sin segundo factor puede llamar directo a Supabase Auth y saltearse ese límite. Ahí frena el límite de verificaciones de Supabase: en producción, 30 cada 5 minutos por IP (Authentication → Rate Limits, visto el 2026-10-19). No hay que subirlo.
