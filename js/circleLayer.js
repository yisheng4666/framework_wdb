//---------------------------------------------------------------------------
//  File: CircleLayer.js
//  Change: 杨国强，创建于2016-09-19
//
//---------------------------------------------------------------------------

function CircleLayer(layer) {
	if (!layer.data)
		layer.data = 'T0';
	var drawMain = null; // 绘制主画布
	var drawPreview = null; // 绘制预览画布
	var vertexShaderStr = `
			precision mediump float;
			const float PI = 3.1415926536;
			const float RADIAN_HALF = 3.1415926536/360.0;
			const float RADIAN_REVERSE = 180.0/3.1415926536;
			
			vec2 mercatorProjectViewport(
			  vec2 lnglat,
			  vec3 mapParam, // center lat, center lon, zoom
			  vec2 viewport // viewport: [width, height]
			) {
				// k, y1 calculated in JS
				//float k = pow(2.0, mapParam.z - 3.0) * TILE_SIZE;
				//float y1 = log(tan(PI / 4.0 + centerLngLat.y * PI / 360.0));
				float y2 = log(tan(PI / 4.0 + lnglat.y * RADIAN_HALF));
        return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
            (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
			}

			attribute vec4 scatterData;  // lat, lon, radius, pointPos
			uniform vec2 dataRange;
			uniform vec3 mapParam;  // center lat, center lon, zoom
			uniform vec2 viewPort;
			uniform vec4 uColor;
			uniform vec4 latlonRange;

			varying vec4 vColor;
			varying vec2 vCenter;
			varying float vRadius;
			void main(void)
			{
				vec2 pos;
				float radius = scatterData[2];
				if (scatterData[3]==0.0)
					pos = vec2(scatterData[0]-radius, scatterData[1]-radius);
				else if (scatterData[3]==1.0)
					pos = vec2(scatterData[0]+radius, scatterData[1]-radius);
				else if (scatterData[3]==2.0)
					pos = vec2(scatterData[0]-radius, scatterData[1]+radius);
				else
					pos = vec2(scatterData[0]+radius, scatterData[1]+radius);
		    if (latlonRange[0]<=0.0) {
		    	gl_Position = vec4(mercatorProjectViewport(pos, mapParam, viewPort), 0.0, 1.0);
			    vCenter = mercatorProjectViewport(scatterData.xy, mapParam, viewPort);
			    vRadius = abs(gl_Position[0]-vCenter[0])*viewPort[0]/2.0;
			    vCenter.x = (vCenter.x+1.0)*viewPort[0]/2.0;
			    vCenter.y = (vCenter.y+1.0)*viewPort[1]/2.0;
		    } else {
		    	gl_Position = vec4((pos[0]-latlonRange[0])/latlonRange[1],(pos[1]-latlonRange[2])/latlonRange[3], 0.0, 1.0);
		    	vCenter = vec2( (scatterData[0]-latlonRange[0])/latlonRange[1],(scatterData[1]-latlonRange[2])/latlonRange[3] );
			    vCenter.x = (vCenter.x+1.0)*viewPort[0]/2.0;
			    vCenter.y = (vCenter.y+1.0)*viewPort[1]/2.0;
			    vRadius = -1.0;
		    }
		    vColor = uColor;
			}
	`;

	var fragmentShaderStr = `
      precision mediump float;
			const float PI = 3.1415926536;
			const float span = PI/16.0;
			const float centerSize = 3.0; // 中间红点的大小
			uniform float uStep;
			uniform float layerOpacity;
			varying vec4 vColor;
			varying vec2 vCenter;
			varying float vRadius;

			void main(void)
			{
				if (vRadius<0.0) {
					float dist = distance( gl_FragCoord.xy, vCenter );
					if (dist>2.0) discard;
					gl_FragColor = vec4(1.0,0.1,0.1,dist);
				} else {
					float dist = distance( gl_FragCoord.xy, vCenter );
					if (dist>vRadius) discard;
					float alpha = 0.3;
					if (dist<vRadius-1.0 && dist>centerSize) {
						alpha = 1.0-dist/vRadius;
						float delta = uStep-(1.0-alpha);
						alpha = alpha - 0.2;
						if (alpha<0.2) alpha = 0.2;
						if (delta>0.0 && delta<0.1)
							alpha = alpha + (0.1 - delta)*3.0;
					}
					if (dist>centerSize)
						gl_FragColor = vec4(vColor.xyz, alpha);
					else {
						gl_FragColor = vec4(1.0,0.1,0.1,1.0);
					}
					gl_FragColor.w = gl_FragColor.w * layerOpacity;
				}
			}
	`;

	
	var pDataRange = [0,1000000000];
	var lonRange = [360, -1];
	var latRange = [360, -1];
	var buf = [];
	function initCanvas() {		
		let index = 0;
		let min = Number.MAX_VALUE, max = Number.MIN_VALUE;
		for (let i=0;i<30;i++) {
			let d = [Math.random()*1.5+115.4,Math.random()*1.5+39.4, 0.1+Math.random()*0.05];
			//let d = [116.4,39.9, 0.5];
			if (d[0]<lonRange[0]) lonRange[0] = d[0];
			if (d[0]>lonRange[1]) lonRange[1] = d[0];
			if (d[1]<latRange[0]) latRange[0] = d[1];
			if (d[1]>latRange[1]) latRange[1] = d[1];
			for (let j=0;j<6;j++) {
				buf[index++] = d[0];
				buf[index++] = d[1];
				buf[index++] = d[2];
				buf[index++] = j<3 ? j : (j-2);
			}
		}
		
		let previewCanvas = document.getElementById('layerPreviewCanvas');
		let mainCanvas = document.getElementById('layerMainCanvas');
		drawPreview = initWebGL(previewCanvas, 1);
		drawMain = initWebGL(mainCanvas, 0);
		if (drawPreview) {
			drawPreview();
	  	setLayerPreviewImg(layer.id, previewCanvas.toDataURL("image/png")); 
		}
	}

	function initWebGL(canvasObject, isPreview) {
		let webgl = canvasObject.getContext("webgl");
		
    let vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    let fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, vertexShaderStr);
    webgl.shaderSource(fragmentShaderObject, fragmentShaderStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}
    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}

    let programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}

    webgl.useProgram(programObject);

    let attrScatterData = webgl.getAttribLocation(programObject, "scatterData");
    let attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    let attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    let attrColor = webgl.getUniformLocation(programObject, "uColor");
    let attrLatlonRange = webgl.getUniformLocation(programObject, "latlonRange");
    let attrStep = webgl.getUniformLocation(programObject, "uStep");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");
	  webgl.uniform1f(attrOpacity, 1);
   
    let scatterBuffer = webgl.createBuffer();
	  if (isPreview)
		  webgl.uniform4f(attrLatlonRange, lonRange[0]+(lonRange[1]-lonRange[0])/2, (lonRange[1]-lonRange[0])/2, latRange[0]+(latRange[1]-latRange[0])/2, (latRange[1]-latRange[0])/2);
		else
		  webgl.uniform4f(attrLatlonRange, -1, 0,0,0);
	  webgl.uniform4fv(attrColor, [0.0, 0.6, 0.9, 1.0]);
	  webgl.uniform2fv(attrViewPort, [canvasObject.width,canvasObject.height]);
		  
		webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
	  webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(buf), webgl.DYNAMIC_DRAW);
    
    return function() {
    	webgl.useProgram(programObject);
    	if (isPreview) {
		  	webgl.clearColor(0.0, 0.0, 0.0, 0.8);
				webgl.clear(webgl.COLOR_BUFFER_BIT);
    	} else {
			let temp = ol.proj.toLonLat(map.getView().getCenter());
			let center = {lon:temp[0], lat:temp[1]};//map.center();
			temp = map.getSize();
			let size = {x:temp[0],y:temp[1]};//map.size();
			  
			  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
			  let k = Math.pow(2.0, map.getView().getZoom() - 3.0) * 512.0 / 45.0;
			  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
			  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
			  webgl.uniform1f(attrOpacity, layer.opacity);
			  webgl.uniform1f(attrStep, currStep);
			}
		  
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
		  webgl.enableVertexAttribArray(attrScatterData); 
		  webgl.vertexAttribPointer(attrScatterData, 4, webgl.FLOAT, false, 0, 0);
		  webgl.drawArrays(webgl.TRIANGLES, 0, buf.length/4);
		}
	}
		
	initCanvas();

	var currStep = 0.0;
	function redrawMain() {
		currStep = (currStep+0.02) % (1.2);
		if (drawMain) {
			drawMain();
		}
	}
	layer.onDraw = redrawMain;
	
}
