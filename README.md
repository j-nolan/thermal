# Thermal

Live heatmap for the Waveshare Smartphone IR Thermal Imaging Camera (B). The page runs in Chrome on Android. It has no build step and no dependencies.

The camera uses a Meridian SenXor 80x62 sensor. It is a USB serial device (0416:b020, "USB Virtual COM"), not a UVC camera. The page reads it with WebUSB, so the page must load over HTTPS or from localhost.

Use the page:

1. Close the SenXor app.
2. Connect the camera to the phone.
3. If Android asks which app to open, close the dialog.
4. Open the page in Chrome and push Connect.

Run the tests with `node --test`.

The code is under the Apache 2.0 license. This project has no connection to Waveshare or Meridian Innovation.
