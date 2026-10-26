# Medidor de Ambiente

Web app para celular: mede o pé-direito com a câmera (realidade aumentada), fotografa cada parede, calcula largura
e altura corrigindo a perspectiva da foto e gera a **planta baixa** da sala e o **desenho de cada parede** com
portas e janelas. Sem build e sem dependências.

## Rodar

```bash
npm start            # python3 -m http.server 8000
```

No celular (mesma rede Wi-Fi): `http://<IP-do-computador>:8000`. O IP aparece em `hostname -I`.

Testes: `npm test` (Node 20+).

### Liberar a realidade aumentada (fita métrica)

O navegador só libera AR em endereço seguro (HTTPS ou `localhost`). O resto do app funciona sem isso. Para
testar na rede local, use uma destas opções:

- **HTTPS local (sem configurar o celular):** `npm run start:https` gera um certificado autoassinado em `.certs/`
  e serve em `https://<IP-do-computador>:8443`. No aviso do Chrome, toque em *Avançado → Continuar*.
- **Flag do Chrome:** no Chrome do Android, abra `chrome://flags`, procure
  *Insecure origins treated as secure*, adicione `http://<IP-do-computador>:8000`, ative e reinicie o Chrome.
- **Cabo USB:** com depuração USB ativa, rode `adb reverse tcp:8000 tcp:8000` e abra `http://localhost:8000` no
  celular.

O aparelho precisa ter o *Google Play Services para RA* (ARCore). Sem suporte, os botões de AR não aparecem e as
medidas podem ser digitadas.

## Fita métrica em AR

- **Fita métrica** (barra superior): uso livre, várias medidas seguidas, com a linha e o valor desenhados sobre a
  câmera em tempo real.
- **Medir em AR** (ao lado de cada campo de medida): faz uma medida e preenche o campo em **Usar X m**.
- Modo **Distância**: marque o início e o fim em qualquer superfície detectada (chão, mesa, parede com textura).
  Para a largura de uma parede, meça no chão, rente a ela, de canto a canto: o chão é detectado com muito mais
  facilidade que uma parede lisa.
- Modo **Altura**: marque a base no chão (ou superfície horizontal) e suba a mira em linha reta até o topo. É o
  modo para o pé-direito: base no canto da sala, subindo pela quina até o teto.

## Como medir

1. **Pé-direito** (uma vez por ambiente): **Medir em AR** ao lado do campo, ou digite o valor medido com trena.
2. **+ Nova parede** → **Tirar foto**: o mais de frente possível, com os 4 cantos da parede (encontro com teto e
   chão) visíveis. Use a câmera principal, sem zoom e sem grande-angular.
3. **Escala**: o padrão é **Pé-direito da sala**, sem nada na parede. A alternativa é **Objeto de tamanho
   conhecido** (porta padrão 80 × 210 cm, folha A4, cartão ou medidas próprias), marcando os 4 cantos dele.
4. **Parede**: toque nos 4 cantos da parede. Arraste os pontos para ajustar; a lupa aparece enquanto arrasta.
5. **Portas e janelas** (opcional): + Porta / + Janela e os 4 cantos de cada uma.
6. Salve e repita para as outras paredes, **andando sempre no mesmo sentido** pela sala. Em cada parede da
   lista, ajuste o **ângulo do canto com a próxima** (padrão 90°). A aba **Planta** avisa se as medidas não
   fecham o ambiente.

Os desenhos podem ser baixados em PNG ou SVG. Os dados ficam salvos no próprio navegador (`localStorage`).

## Como funciona

- **Fita métrica** (`js/ar-tape.js`): WebXR com *hit-test* fixa os pontos nas superfícies detectadas pelo
  ARCore. A cada quadro, os pontos 3D são projetados na tela para desenhar linhas e rótulos. No modo Altura, o
  topo é o ponto da reta vertical, saindo da base, mais próximo da linha de mira.
- **Escala pelo pé-direito** (`rectangleAspectRatio` em `js/geometry.js`): a parede é um retângulo. Conhecendo a
  lente da câmera (lida do EXIF da foto, ou 26 mm equivalente quando a foto não informa), os 4 cantos em
  perspectiva revelam a proporção real largura/altura. Com a altura conhecida, sai a largura.
- **Escala por objeto**: os 4 cantos do objeto e as medidas reais definem uma homografia que leva qualquer ponto
  do plano da parede para centímetros.

## Limitações

- Os cantos marcados precisam ser o encontro real da parede com o teto e com o chão. Se um móvel esconder um
  canto, estime onde ele está.
- Foto de frente quase não depende da lente. Numa foto girada uns 35°, um erro de 15% na lente vira cerca de 5%
  de erro na largura. Prefira fotos de frente.
- Lentes grande-angulares têm distorção (barril) que não é corrigida.
- Paredes com alturas diferentes (teto inclinado, viga): use **Corrigir altura**, que passa a valer como a altura
  conhecida daquela parede.
- Parede larga demais para caber numa foto: meça com trena e use **Corrigir largura**.
- Se as paredes forem fotografadas no sentido horário, a planta sai espelhada (forma e medidas continuam certas).
